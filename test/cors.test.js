import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import cors from 'cors';
import express from 'express';

import { createApp } from '../src/app.js';
import { loadCorsOptions, parseAllowedOrigins } from '../src/config/cors.js';
import { loadServerConfig } from '../src/config/server.js';
import { createStore } from '../src/data/store.js';
import { createLogger } from '../src/observability/logger.js';
import { createFinanceService } from '../src/services/financeService.js';
import { createPubSub } from '../src/streaming/pubsub.js';

/** Starts a throwaway app guarded by the allow-list CORS middleware. */
async function withServer(env, run) {
  const app = express();
  app.use(cors(loadCorsOptions(env)));
  app.get('/probe', (_req, res) => res.json({ ok: true }));

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}/probe`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

/** Starts the actual /export, /graphql/stream, and /graphql mounts from src/app.js. */
async function withApp(env, run) {
  const { httpServer, shutdown } = await createApp({
    config: loadServerConfig({}),
    corsOptions: loadCorsOptions(env),
    store: createStore(),
    finance: createFinanceService(),
    logger: createLogger({ write: () => {} }),
    pubsub: createPubSub(),
  });

  await new Promise((resolve) => httpServer.listen(0, '127.0.0.1', resolve));
  const { port } = httpServer.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await shutdown();
  }
}

describe('cors configuration', () => {
  it('parses a comma-separated allow-list and ignores blanks', () => {
    assert.deepEqual(parseAllowedOrigins(' https://a.example , ,https://b.example '), [
      'https://a.example',
      'https://b.example',
    ]);
    assert.deepEqual(parseAllowedOrigins(undefined), []);
  });

  it('echoes allowed origins and never emits a wildcard', async () => {
    await withServer({ CORS_ALLOWED_ORIGINS: 'https://app.example' }, async (url) => {
      const allowed = await fetch(url, { headers: { origin: 'https://app.example' } });
      assert.equal(allowed.headers.get('access-control-allow-origin'), 'https://app.example');

      const denied = await fetch(url, { headers: { origin: 'https://evil.example' } });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);

      const noOrigin = await fetch(url);
      assert.equal(noOrigin.headers.get('access-control-allow-origin'), null);
      assert.equal(noOrigin.status, 200);
    });
  });

  it('denies every origin when the allow-list is unset', async () => {
    await withServer({}, async (url) => {
      const response = await fetch(url, { headers: { origin: 'https://app.example' } });
      assert.equal(response.headers.get('access-control-allow-origin'), null);
      assert.equal(response.status, 200);
    });
  });

  it('enforces the allow-list on the production /export, /graphql/stream, and /graphql mounts', async () => {
    const env = { CORS_ALLOWED_ORIGINS: 'https://app.example' };
    await withApp(env, async (baseUrl) => {
      const routes = [
        { path: '/export', init: {} },
        {
          // A valid one-shot query completes and closes the response itself,
          // instead of leaving an SSE stream open for the test to clean up.
          path: `/graphql/stream?query=${encodeURIComponent('{ __typename }')}`,
          init: { headers: { accept: 'text/event-stream' }, method: 'GET' },
        },
        {
          path: '/graphql',
          init: {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ query: '{ __typename }' }),
          },
        },
      ];

      for (const { path, init } of routes) {
        const allowed = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { ...init.headers, origin: 'https://app.example' },
        });
        assert.equal(allowed.status, 200, `${path} should succeed for an allowed origin`);
        assert.equal(
          allowed.headers.get('access-control-allow-origin'),
          'https://app.example',
          `${path} should echo the allowed origin`
        );

        const denied = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { ...init.headers, origin: 'https://evil.example' },
        });
        assert.equal(denied.status, 200, `${path} should still respond for a denied origin`);
        assert.equal(
          denied.headers.get('access-control-allow-origin'),
          null,
          `${path} should not echo a denied origin`
        );

        const noOrigin = await fetch(`${baseUrl}${path}`, init);
        assert.equal(noOrigin.status, 200, `${path} should succeed without an Origin header`);
        assert.equal(
          noOrigin.headers.get('access-control-allow-origin'),
          null,
          `${path} should not emit a CORS header without an Origin header`
        );
      }
    });
  });
});
