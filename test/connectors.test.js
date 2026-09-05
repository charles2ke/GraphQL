import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createConnectors, isMockEndpoint } from '../src/connectors/index.js';
import { createHttpClient } from '../src/connectors/httpClient.js';
import { createOpenTradingHttpConnector } from '../src/connectors/opentrading/httpConnector.js';
import { loadFinanceConfig } from '../src/config/finance.js';
import { createLogger } from '../src/observability/logger.js';
import { createMetrics } from '../src/observability/metrics.js';

const silentLogger = createLogger({ write: () => {} });

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe('production HTTP connectors', () => {
  it('sends bearer auth and parses the upstream payload', async () => {
    const calls = [];
    const connector = createOpenTradingHttpConnector({
      endpoint: 'https://trading.example/api/',
      apiKey: 'test-key',
      logger: silentLogger,
      metrics: createMetrics(),
      fetchImpl: async (url, options) => {
        calls.push({ url, options });
        return jsonResponse({ accounts: [{ acct_id: 'acct-9' }] });
      },
    });

    const accounts = await connector.listAccounts();

    assert.equal(calls[0].url, 'https://trading.example/api/accounts');
    assert.equal(calls[0].options.headers.authorization, ['Bearer', 'test-key'].join(' '));
    assert.deepEqual(accounts, [{ acct_id: 'acct-9' }]);
  });

  it('retries retryable failures and records metrics', async () => {
    const metrics = createMetrics();
    let attempts = 0;
    const client = createHttpClient({
      source: 'OpenTrading',
      endpoint: 'https://trading.example',
      maxRetries: 2,
      retryBackoffMs: 0,
      logger: silentLogger,
      metrics,
      fetchImpl: async () => {
        attempts += 1;
        return attempts < 3 ? jsonResponse({}, 503) : jsonResponse({ ok: true });
      },
    });

    assert.deepEqual(await client.request('/accounts'), { ok: true });
    assert.equal(attempts, 3);

    const successes = metrics
      .snapshot()
      .counters.find((counter) => counter.name === 'finance_upstream_request_total' && counter.labels.outcome === 'success');
    assert.equal(successes.value, 1);
  });

  it('does not retry client errors and reports the upstream status', async () => {
    let attempts = 0;
    const client = createHttpClient({
      source: 'tax-break',
      endpoint: 'https://tax.example',
      retryBackoffMs: 0,
      logger: silentLogger,
      metrics: createMetrics(),
      fetchImpl: async () => {
        attempts += 1;
        return jsonResponse({}, 400);
      },
    });

    await assert.rejects(() => client.request('/tax-events'), /HTTP 400/);
    assert.equal(attempts, 1);
  });

  it('aborts requests that exceed the configured timeout', async () => {
    const client = createHttpClient({
      source: 'Portfolio-Watcher',
      endpoint: 'https://portfolio.example',
      timeoutMs: 10,
      maxRetries: 0,
      retryBackoffMs: 0,
      logger: silentLogger,
      metrics: createMetrics(),
      fetchImpl: (_url, { signal }) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            const error = new Error('aborted');
            error.name = 'AbortError';
            reject(error);
          });
        }),
    });

    await assert.rejects(() => client.request('/positions'), /timed out after 10ms/);
  });

  it('reports degraded health when the readiness probe fails', async () => {
    const client = createHttpClient({
      source: 'OpenTrading',
      endpoint: 'https://trading.example',
      maxRetries: 0,
      retryBackoffMs: 0,
      logger: silentLogger,
      metrics: createMetrics(),
      fetchImpl: async () => jsonResponse({}, 500),
    });

    assert.equal((await client.health()).status, 'degraded');
  });
});

describe('connector selection', () => {
  it('uses mock adapters for mock endpoints and HTTP clients otherwise', async () => {
    assert.equal(isMockEndpoint('mock://opentrading'), true);
    assert.equal(isMockEndpoint('https://trading.example'), false);

    const mocks = createConnectors({ config: loadFinanceConfig({}), logger: silentLogger, metrics: createMetrics() });
    assert.equal((await mocks.openTrading.health()).endpoint, 'mock://opentrading');

    const live = createConnectors({
      config: loadFinanceConfig({ OPENTRADING_ENDPOINT: 'https://trading.example', OPENTRADING_API_KEY: 'key' }),
      logger: silentLogger,
      metrics: createMetrics(),
      fetchImpl: async () => jsonResponse({ accounts: [] }),
    });

    assert.deepEqual(await live.openTrading.listAccounts(), []);
    assert.equal((await live.portfolioWatcher.health()).endpoint, 'mock://portfolio-watcher');
  });

  it('fails safely when live endpoints are configured without credentials', async () => {
    const live = createConnectors({
      config: loadFinanceConfig({ OPENTRADING_ENDPOINT: 'https://trading.example' }),
      logger: silentLogger,
      metrics: createMetrics(),
    });

    await assert.rejects(() => live.openTrading.listAccounts(), /missing API credentials/);
    const health = await live.openTrading.health();
    assert.equal(health.status, 'degraded');
    assert.equal(health.error, 'missing API credentials');
  });

  it('reads timeout and retry settings from the environment', () => {
    const config = loadFinanceConfig({ FINANCE_HTTP_TIMEOUT_MS: '250', FINANCE_HTTP_MAX_RETRIES: '4', FINANCE_MAX_PAGE_SIZE: '10' });
    assert.equal(config.openTrading.timeoutMs, 250);
    assert.equal(config.taxBreak.maxRetries, 4);
    assert.equal(config.maxPageSize, 10);
  });
});
