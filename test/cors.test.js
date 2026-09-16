import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import cors from 'cors';
import express from 'express';

import { loadCorsOptions, parseAllowedOrigins } from '../src/config/cors.js';

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
});
