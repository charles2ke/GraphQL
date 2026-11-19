import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { getIntrospectionQuery, parse, specifiedRules, validate } from 'graphql';

import { createApp, createSignalHandler } from '../src/app.js';
import { createMemoryCacheStore } from '../src/cache/index.js';
import { loadCorsOptions } from '../src/config/cors.js';
import { loadServerConfig } from '../src/config/server.js';
import { createStore } from '../src/data/store.js';
import { createLogger } from '../src/observability/logger.js';
import { createMetrics } from '../src/observability/metrics.js';
import { createSchema } from '../src/schema.js';
import { createFinanceService } from '../src/services/financeService.js';
import { createPubSub } from '../src/streaming/pubsub.js';
import { createDepthLimitRule } from '../src/validation/depthLimit.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEEP_QUERY = '{ users { posts { author { name } } } }';
const schema = createSchema();

function depthErrors(query, maxDepth) {
  return validate(schema, parse(query), [...specifiedRules, createDepthLimitRule(maxDepth)]).map((error) => error.message);
}

/** Boots the production wiring from src/app.js on an ephemeral port. */
async function withApp({ config = {}, env = {}, finance = createFinanceService() } = {}, run) {
  const lines = [];
  const { httpServer, shutdown } = await createApp({
    config: { ...loadServerConfig({}), ...config },
    corsOptions: loadCorsOptions(env),
    store: createStore(),
    finance,
    logger: createLogger({ write: (line) => lines.push(JSON.parse(line)) }),
    metrics: createMetrics(),
    pubsub: createPubSub(),
  });
  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));

  try {
    await run({ baseUrl: `http://127.0.0.1:${httpServer.address().port}`, httpServer, shutdown, lines });
  } finally {
    await shutdown();
  }
}

const postGraphQL = (baseUrl, query, headers = {}) =>
  fetch(`${baseUrl}/graphql`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ query }),
  });

const streamGraphQL = (baseUrl, query) => fetch(`${baseUrl}/graphql/stream?query=${encodeURIComponent(query)}`);

describe('query depth limit', () => {
  it('counts nested fields through fragments and inline fragments', () => {
    assert.deepEqual(depthErrors('{ users { id } }', 2), []);
    assert.deepEqual(depthErrors('{ users { posts { title } } }', 2), [
      'Anonymous operation has depth 3, which exceeds the maximum query depth of 2.',
    ]);
    assert.deepEqual(
      depthErrors('query Deep { users { ...P } } fragment P on User { posts { ... on Post { author { name } } } }', 3),
      ['Operation "Deep" has depth 4, which exceeds the maximum query depth of 3.']
    );
  });

  it('ignores introspection fields and terminates on fragment cycles', () => {
    assert.deepEqual(depthErrors(getIntrospectionQuery(), 2), []);

    const errors = depthErrors('{ users { ...A } } fragment A on User { ...B } fragment B on User { ...A }', 10);
    assert.equal(errors.length, 1);
    assert.match(errors[0], /Cannot spread fragment "A" within itself/);
  });
});

describe('server config', () => {
  it('parses server settings and falls back to defaults on invalid values', () => {
    assert.deepEqual(
      loadServerConfig({ PORT: '8080', GRAPHQL_MAX_DEPTH: '5', SHUTDOWN_TIMEOUT_MS: '2500', NODE_ENV: 'production' }),
      { port: 8080, maxQueryDepth: 5, introspection: false, shutdownTimeoutMs: 2500 }
    );
    assert.deepEqual(loadServerConfig({ GRAPHQL_MAX_DEPTH: '0', SHUTDOWN_TIMEOUT_MS: 'soon' }), {
      port: 4000,
      maxQueryDepth: 10,
      introspection: true,
      shutdownTimeoutMs: 10000,
    });
  });
});

describe('http app', () => {
  it('tags responses and log lines with a request id', async () => {
    await withApp({ env: { CORS_ALLOWED_ORIGINS: 'https://app.example' } }, async ({ baseUrl, lines }) => {
      const generated = await fetch(`${baseUrl}/health`);
      assert.match(generated.headers.get('x-request-id'), UUID);

      const reused = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': 'trace-42' } });
      assert.equal(reused.headers.get('x-request-id'), 'trace-42');

      // Ids with unexpected characters or lengths are replaced, never echoed.
      for (const unsafe of ['has spaces', 'x'.repeat(129)]) {
        const replaced = await fetch(`${baseUrl}/health`, { headers: { 'x-request-id': unsafe } });
        assert.match(replaced.headers.get('x-request-id'), UUID);
      }

      const response = await postGraphQL(baseUrl, '{ taxEstimate(taxYear: 2026) { estimatedTax } }', {
        origin: 'https://app.example',
        'x-request-id': 'trace-43',
      });
      assert.equal(response.status, 200);
      assert.equal(response.headers.get('x-request-id'), 'trace-43');
      assert.match(response.headers.get('access-control-expose-headers'), /X-Request-Id/i);

      // Both the Apollo plugin and resolver loggers carry the id.
      const tagged = lines.filter((line) => line.requestId === 'trace-43').map((line) => line.message);
      assert.ok(tagged.includes('graphql operation completed'), JSON.stringify(tagged));
      assert.ok(tagged.includes('finance resolver completed'), JSON.stringify(tagged));
    });
  });

  it('enforces the query depth limit on /graphql and /graphql/stream', async () => {
    await withApp({ config: { maxQueryDepth: 3 } }, async ({ baseUrl }) => {
      const message = /^Anonymous operation has depth 4, which exceeds the maximum query depth of 3\.$/;

      const http = await postGraphQL(baseUrl, DEEP_QUERY);
      assert.equal(http.status, 400);
      const httpBody = await http.json();
      assert.match(httpBody.errors[0].message, message);
      assert.equal(httpBody.errors[0].extensions.code, 'GRAPHQL_VALIDATION_FAILED');

      const stream = await streamGraphQL(baseUrl, DEEP_QUERY);
      assert.equal(stream.status, 400);
      assert.match((await stream.json()).errors[0].message, message);

      const allowed = await postGraphQL(baseUrl, '{ users { posts { title } } }');
      assert.equal(allowed.status, 200);
      assert.equal((await allowed.json()).errors, undefined);
    });
  });

  it('rejects introspection on both endpoints when it is disabled', async () => {
    await withApp({ config: { introspection: false } }, async ({ baseUrl }) => {
      const query = '{ __schema { queryType { name } } }';

      assert.equal((await postGraphQL(baseUrl, query)).status, 400);

      const stream = await streamGraphQL(baseUrl, query);
      assert.equal(stream.status, 400);
      assert.match((await stream.json()).errors[0].message, /introspection has been disabled/);

      const typename = await streamGraphQL(baseUrl, '{ __typename }');
      assert.equal(typename.status, 200);
      await typename.text();
    });
  });

  it('shuts down gracefully: ends open streams, stops listening, and flushes the cache once', async () => {
    const cacheCalls = [];
    const cacheStore = {
      ...createMemoryCacheStore(),
      flush: async () => cacheCalls.push('flush'),
      close: async () => cacheCalls.push('close'),
    };

    await withApp({ finance: createFinanceService({ cacheStore }) }, async ({ baseUrl, httpServer, shutdown }) => {
      // fetch resolves once the subscription is set up and headers are sent.
      const stream = await streamGraphQL(baseUrl, 'subscription { userCreated { id } }');
      assert.equal(stream.status, 200);

      await Promise.all([shutdown(), shutdown()]);

      // No `complete` event: the client should reconnect rather than stop.
      const body = await stream.text();
      assert.match(body, /: connected/);
      assert.doesNotMatch(body, /event: complete/);
      assert.equal(httpServer.listening, false);
      assert.deepEqual(cacheCalls, ['flush', 'close']);
    });
  });
});

describe('shutdown signals', () => {
  /** Signal listener driven by a scripted clock; records shutdowns, exits and log messages. */
  function signalHarness(times) {
    const calls = { shutdowns: 0, exits: [], messages: [] };
    const onSignal = createSignalHandler({
      shutdown: async () => {
        calls.shutdowns += 1;
      },
      shutdownTimeoutMs: 0,
      logger: createLogger({ write: (line) => calls.messages.push(JSON.parse(line).message) }),
      exit: (code) => calls.exits.push(code),
      now: () => times.shift(),
    });
    return { onSignal, calls };
  }

  it('ignores a duplicate of the first signal but forces an exit on a later one', async () => {
    // One Ctrl+C under `node --watch` delivers SIGINT twice within milliseconds.
    const duplicate = signalHarness([0, 15]);
    await Promise.all([duplicate.onSignal('SIGINT'), duplicate.onSignal('SIGINT')]);
    assert.deepEqual(duplicate.calls, { shutdowns: 1, exits: [], messages: ['shutting down', 'shutdown complete'] });

    const deliberate = signalHarness([0, 1500]);
    await Promise.all([deliberate.onSignal('SIGTERM'), deliberate.onSignal('SIGTERM')]);
    assert.deepEqual(deliberate.calls.exits, [1]);
    assert.ok(deliberate.calls.messages.includes('forced shutdown'));
  });
});
