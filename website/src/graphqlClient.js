// Dependency-free GraphQL client helpers used by the API Explorer. Kept free
// of Vite/React specifics so they can be unit tested with `node --test`.

const OPERATION_TYPES = new Set(['query', 'mutation', 'subscription'])

/** Derives the HTTP and Server-Sent Events endpoints from the configured URL. */
export function resolveEndpoints(configuredUrl) {
  const http = (configuredUrl || '/graphql').replace(/\/+$/, '')
  return { http, stream: `${http}/stream` }
}

/**
 * Returns the type of the first operation in a GraphQL document ('query',
 * 'mutation' or 'subscription'), or null when there is none. Comments,
 * strings and fragment bodies are skipped, so a `fragment` defined before the
 * operation is handled.
 */
export function detectOperationType(source) {
  let depth = 0
  let index = 0

  while (index < source.length) {
    const char = source[index]

    if (char === '#') {
      const end = source.indexOf('\n', index)
      index = end === -1 ? source.length : end + 1
    } else if (char === '"') {
      const block = source.startsWith('"""', index)
      const quote = block ? '"""' : '"'
      index += quote.length
      while (index < source.length && !source.startsWith(quote, index)) index += source[index] === '\\' && !block ? 2 : 1
      index += quote.length
    } else if (char === '{') {
      // A bare selection set at the top level is shorthand for a query.
      if (depth === 0) return 'query'
      depth += 1
      index += 1
    } else if (char === '}') {
      depth = Math.max(0, depth - 1)
      index += 1
    } else if (/[A-Za-z_]/.test(char)) {
      const word = /^[A-Za-z_]\w*/.exec(source.slice(index))[0]
      if (depth === 0 && OPERATION_TYPES.has(word)) return word
      index += word.length
      // Skip a fragment's type condition and body.
      if (depth === 0 && word === 'fragment') {
        const open = source.indexOf('{', index)
        if (open === -1) return null
        depth = 1
        index = open + 1
      }
    } else {
      index += 1
    }
  }

  return null
}

/** Parses the variables editor content; blank input means "no variables". */
export function parseVariables(text) {
  if (!text.trim()) return { variables: undefined }

  let value
  try {
    value = JSON.parse(text)
  } catch (error) {
    return { error: `Variables are not valid JSON: ${error.message}` }
  }

  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return { error: 'Variables must be a JSON object, e.g. { "id": "1" }.' }
  }
  return { variables: value }
}

/**
 * Incremental Server-Sent Events parser: feed decoded text chunks and get the
 * complete `{ event, data }` frames back. Comment frames (`: ping`) are
 * skipped. The service emits LF line endings only.
 */
export function createSseParser() {
  let buffer = ''

  return function push(chunk) {
    buffer += chunk
    const frames = []
    let boundary

    while ((boundary = buffer.indexOf('\n\n')) !== -1) {
      const block = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)

      let event = 'message'
      const data = []
      for (const line of block.split('\n')) {
        if (line === '' || line.startsWith(':')) continue
        const colon = line.indexOf(':')
        const field = colon === -1 ? line : line.slice(0, colon)
        const value = colon === -1 ? '' : line.slice(colon + 1).replace(/^ /, '')
        if (field === 'event') event = value
        else if (field === 'data') data.push(value)
      }

      if (event !== 'message' || data.length > 0) {
        frames.push({ event, data: data.length > 0 ? data.join('\n') : undefined })
      }
    }

    return frames
  }
}

function parseBody(text) {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

function requestInit({ query, variables, signal, accept }) {
  return {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: accept },
    body: JSON.stringify({ query, variables }),
    signal,
  }
}

/** Sends a query or mutation over HTTP and reports status, timing and request id. */
export async function executeOperation({ url, query, variables, signal, fetchImpl = fetch, now = () => performance.now() }) {
  const startedAt = now()
  const response = await fetchImpl(url, requestInit({ query, variables, signal, accept: 'application/json' }))
  const body = parseBody(await response.text())

  return {
    status: response.status,
    ok: response.ok,
    requestId: response.headers.get('x-request-id'),
    durationMs: Math.round(now() - startedAt),
    body,
  }
}

/**
 * Runs an operation on the SSE endpoint, calling `onOpen({ status, requestId })`
 * once the stream is established and `onNext(payload)` for each `next` event.
 * Resolves with how the stream ended:
 * - 'complete': the server finished the operation;
 * - 'closed': the connection ended without `complete` (e.g. server restart);
 * - 'aborted': `signal` was aborted;
 * - 'rejected': the server answered without a stream (validation error, 503),
 *   with the response in `body`.
 */
export async function streamOperation({ url, query, variables, signal, onOpen, onNext, fetchImpl = fetch }) {
  let response
  try {
    response = await fetchImpl(url, requestInit({ query, variables, signal, accept: 'text/event-stream' }))
  } catch (error) {
    if (signal?.aborted) return { ended: 'aborted', status: null, requestId: null }
    throw error
  }

  const meta = { status: response.status, requestId: response.headers.get('x-request-id') }
  if (!response.headers.get('content-type')?.includes('text/event-stream')) {
    return { ...meta, ended: 'rejected', body: parseBody(await response.text()) }
  }
  onOpen?.(meta)

  const parse = createSseParser()
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  try {
    for (;;) {
      const { value, done } = await reader.read()
      if (done) return { ...meta, ended: 'closed' }

      for (const frame of parse(value)) {
        if (frame.event === 'next') onNext(parseBody(frame.data))
        else if (frame.event === 'complete') return { ...meta, ended: 'complete' }
      }
    }
  } catch (error) {
    if (signal?.aborted) return { ...meta, ended: 'aborted' }
    throw error
  } finally {
    reader.cancel().catch(() => {})
  }
}
