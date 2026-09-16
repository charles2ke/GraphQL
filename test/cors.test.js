import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { expressMiddleware } from '@as-integrations/express4';
import cors from 'cors';
import express from 'express';

import { loadCorsOptions, parseAllowedOrigins } from '../src/config/cors.js';
import { createStore } from '../src/data/store.js';
import { createExportRouter } from '../src/export/router.js';
import { createSchema } from '../src/schema.js';
import { createFinanceService } from '../src/services/financeService.js';
import { createApolloServer } from '../src/server.js';
import { createPubSub } from '../src/streaming/pubsub.js';
import { createStreamRouter } from '../src/streaming/sseRouter.js';

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

/** Starts the actual /export, /graphql/stream, and /graphql mounts wired the same way as src/index.js. */
async function withApp(env, run) {
  const store = createStore();
  const finance = createFinanceService();
  const pubsub = createPubSub();
  const schema = createSchema();
  const apolloServer = createApolloServer({ schema });
  await apolloServer.start();

  const app = express();
  const corsOptions = loadCorsOptions(env);

  app.use('/export', cors(corsOptions), createExportRouter({ store, finance }));
  app.use(
    '/graphql/stream',
    cors(corsOptions),
    express.json(),
    createStreamRouter({ schema, contextValue: () => ({ store, finance, pubsub }) })
  );
  app.use(
    '/graphql',
    cors(corsOptions),
    express.json(),
    expressMiddleware(apolloServer, { context: async () => ({ store, finance, pubsub }) })
  );

  const server = await new Promise((resolve) => {
    const listener = app.listen(0, () => resolve(listener));
  });
  const { port } = server.address();
  try {
    await run(`http://127.0.0.1:${port}`);
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await apolloServer.stop();
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
        const allowedController = new AbortController();
        const allowed = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { ...init.headers, origin: 'https://app.example' },
          signal: allowedController.signal,
        });
        assert.equal(
          allowed.headers.get('access-control-allow-origin'),
          'https://app.example',
          `${path} should echo the allowed origin`
        );
        allowedController.abort();

        const deniedController = new AbortController();
        const denied = await fetch(`${baseUrl}${path}`, {
          ...init,
          headers: { ...init.headers, origin: 'https://evil.example' },
          signal: deniedController.signal,
        });
        assert.equal(
          denied.headers.get('access-control-allow-origin'),
          null,
          `${path} should not echo a denied origin`
        );
        deniedController.abort();
      }
    });
  });
});
