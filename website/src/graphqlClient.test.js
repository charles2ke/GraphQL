import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  createSseParser,
  detectOperationType,
  executeOperation,
  parseVariables,
  resolveEndpoints,
  streamOperation,
} from './graphqlClient.js'

const encoder = new TextEncoder()

/** A fetch stand-in streaming `chunks` as an SSE response, honouring `signal` like fetch does. */
function sseFetch(chunks, { close = true } = {}) {
  return async (_url, { signal }) =>
    new Response(
      new ReadableStream({
        start(controller) {
          for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
          if (close) controller.close()
          else signal.addEventListener('abort', () => controller.error(signal.reason))
        },
      }),
      { headers: { 'content-type': 'text/event-stream', 'x-request-id': 'req-sse' } },
    )
}

describe('detectOperationType', () => {
  it('finds the first operation, skipping comments, strings and fragments', () => {
    assert.equal(detectOperationType('{ users { id } }'), 'query')
    assert.equal(detectOperationType('# subscription in a comment\nmutation M { deletePost(id: "1") { id } }'), 'mutation')
    assert.equal(
      detectOperationType('fragment F on User { query: posts(search: "} {") { id } }\nsubscription S { userCreated { ...F } }'),
      'subscription',
    )
    assert.equal(detectOperationType('# nothing to run'), null)
  })
})

describe('parseVariables', () => {
  it('accepts blank input or a JSON object and explains anything else', () => {
    assert.deepEqual(parseVariables('  '), { variables: undefined })
    assert.deepEqual(parseVariables('{ "id": "1" }'), { variables: { id: '1' } })
    assert.match(parseVariables('{ id: 1 }').error, /not valid JSON/)
    assert.match(parseVariables('[1]').error, /must be a JSON object/)
  })
})

describe('createSseParser', () => {
  it('reassembles frames split across chunks and skips comments', () => {
    const push = createSseParser()
    assert.deepEqual(push(': connected\n\nevent: next\ndata: {"a"'), [])
    assert.deepEqual(push(':1}\n\n: ping\n\nevent: complete\n\n'), [
      { event: 'next', data: '{"a":1}' },
      { event: 'complete', data: undefined },
    ])
  })
})

describe('resolveEndpoints', () => {
  it('derives the stream endpoint from the configured GraphQL URL', () => {
    assert.deepEqual(resolveEndpoints(undefined), { http: '/graphql', stream: '/graphql/stream' })
    assert.deepEqual(resolveEndpoints('https://api.example/graphql/'), {
      http: 'https://api.example/graphql',
      stream: 'https://api.example/graphql/stream',
    })
  })
})

describe('executeOperation', () => {
  it('posts the operation and reports status, timing and request id', async () => {
    let sent
    const times = [100, 142]
    const result = await executeOperation({
      url: '/graphql',
      query: '{ users { id } }',
      variables: { limit: 1 },
      now: () => times.shift(),
      fetchImpl: async (url, init) => {
        sent = { url, init }
        return new Response('{"data":{"users":[]}}', { status: 200, headers: { 'x-request-id': 'req-1' } })
      },
    })

    assert.equal(sent.url, '/graphql')
    assert.deepEqual(JSON.parse(sent.init.body), { query: '{ users { id } }', variables: { limit: 1 } })
    assert.deepEqual(result, { status: 200, ok: true, requestId: 'req-1', durationMs: 42, body: { data: { users: [] } } })
  })

  it('returns non-JSON bodies as text', async () => {
    const result = await executeOperation({
      url: '/graphql',
      query: '{ users { id } }',
      fetchImpl: async () => new Response('Bad gateway', { status: 502 }),
    })
    assert.equal(result.ok, false)
    assert.equal(result.body, 'Bad gateway')
  })
})

describe('streamOperation', () => {
  it('delivers next events until the server completes the stream', async () => {
    const payloads = []
    let opened
    const result = await streamOperation({
      url: '/graphql/stream',
      query: 'subscription { userCreated { id } }',
      onOpen: (meta) => {
        opened = meta
      },
      onNext: (payload) => payloads.push(payload),
      fetchImpl: sseFetch([': connected\n\nevent: next\ndata: {"data":{"n":1}}\n\n', 'event: next\ndata: {"data":{"n":2}}\n\nevent: complete\n\n']),
    })

    assert.deepEqual(opened, { status: 200, requestId: 'req-sse' })
    assert.deepEqual(payloads, [{ data: { n: 1 } }, { data: { n: 2 } }])
    assert.deepEqual(result, { status: 200, requestId: 'req-sse', ended: 'complete' })
  })

  it('distinguishes server disconnects, client aborts and rejected operations', async () => {
    const closed = await streamOperation({ url: '/s', query: 'subscription { userCreated { id } }', onNext() {}, fetchImpl: sseFetch([': connected\n\n']) })
    assert.equal(closed.ended, 'closed')

    const controller = new AbortController()
    const aborted = await streamOperation({
      url: '/s',
      query: 'subscription { userCreated { id } }',
      signal: controller.signal,
      onNext: () => controller.abort(),
      fetchImpl: sseFetch(['event: next\ndata: {}\n\n'], { close: false }),
    })
    assert.equal(aborted.ended, 'aborted')

    const rejected = await streamOperation({
      url: '/s',
      query: 'subscription { nope }',
      onNext() {},
      fetchImpl: async () => new Response('{"errors":[{"message":"nope"}]}', { status: 400, headers: { 'content-type': 'application/json' } }),
    })
    assert.deepEqual(rejected, { status: 400, requestId: null, ended: 'rejected', body: { errors: [{ message: 'nope' }] } })
  })
})
