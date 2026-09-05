import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { createCacheStore, createFileCacheStore, createMemoryCacheStore } from '../src/cache/index.js';
import { UpstreamHttpError } from '../src/connectors/httpClient.js';
import { classifyUpstreamError } from '../src/observability/errors.js';
import { createLogger } from '../src/observability/logger.js';
import { createMetrics } from '../src/observability/metrics.js';
import { createFinanceService } from '../src/services/financeService.js';

const silentLogger = createLogger({ write: () => {} });

function tempCacheFile() {
  return join(mkdtempSync(join(tmpdir(), 'finance-cache-')), 'cache.json');
}

function tempSharedModule() {
  const directory = mkdtempSync(join(tmpdir(), 'finance-shared-module-'));
  const path = join(directory, 'shared-cache.cjs');
  writeFileSync(
    path,
    `module.exports.createSharedCacheStore = function createSharedCacheStore() {
      const entries = new Map();
      return {
        kind: 'shared',
        get(key) {
          const hit = entries.get(key);
          if (!hit || hit.expiresAt <= Date.now()) return undefined;
          return hit.value;
        },
        set(key, value, ttlMs) {
          entries.set(key, { value, expiresAt: Date.now() + ttlMs });
        },
        clear() {
          entries.clear();
        }
      };
    };`
  );
  return path;
}

describe('upstream error classification', () => {
  it('maps HTTP statuses and transport failures to stable categories', () => {
    const cases = [
      [new UpstreamHttpError('OpenTrading', 'unauthorized', { status: 401 }), 'AUTH', 'UPSTREAM_HTTP_401', false],
      [new UpstreamHttpError('OpenTrading', 'throttled', { status: 429, retryable: true }), 'RATE_LIMIT', 'UPSTREAM_HTTP_429', true],
      [new UpstreamHttpError('OpenTrading', 'boom', { status: 503, retryable: true }), 'UPSTREAM_SERVER_ERROR', 'UPSTREAM_HTTP_503', true],
      [new UpstreamHttpError('OpenTrading', 'bad request', { status: 400 }), 'UPSTREAM_CLIENT_ERROR', 'UPSTREAM_HTTP_400', false],
      [new UpstreamHttpError('OpenTrading', 'timed out', { kind: 'timeout', retryable: true }), 'TIMEOUT', 'UPSTREAM_TIMEOUT', true],
      [new UpstreamHttpError('OpenTrading', 'socket reset', { kind: 'network', retryable: true }), 'NETWORK', 'UPSTREAM_NETWORK', true],
      [new Error('unexpected'), 'UNKNOWN', 'UPSTREAM_UNKNOWN', false],
    ];

    for (const [error, category, code, retryable] of cases) {
      const classified = classifyUpstreamError('OpenTrading', error);
      assert.equal(classified.category, category);
      assert.equal(classified.code, code);
      assert.equal(classified.retryable, retryable);
      assert.match(classified.message, /OpenTrading connector/);
    }
  });

  it('counts classified failures per source and category', async () => {
    const metrics = createMetrics();
    const finance = createFinanceService({
      logger: silentLogger,
      metrics,
      cacheStore: createMemoryCacheStore(),
      connectors: {
        openTrading: {
          listAccounts: async () => [],
          listTrades: async () => {
            throw new UpstreamHttpError('OpenTrading', 'throttled', { status: 429, retryable: true });
          },
          listOrders: async () => [],
        },
        portfolioWatcher: { listPositions: async () => [], listPerformanceSnapshots: async () => [] },
        taxBreak: { mapTradesToTaxEvents: async () => [], estimateTax: async () => ({ events: [] }) },
      },
    });

    const history = await finance.tradeHistory({});

    assert.equal(history.errors[0].category, 'RATE_LIMIT');
    assert.equal(history.errors[0].retryable, true);
    const counter = metrics
      .snapshot()
      .counters.find((entry) => entry.name === 'finance_upstream_errors_total' && entry.labels.category === 'RATE_LIMIT');
    assert.equal(counter.value, 1);
    assert.equal(counter.labels.source, 'OpenTrading');
  });
});

describe('cache strategies', () => {
  it('expires memory entries once the TTL elapses', async () => {
    const store = createMemoryCacheStore();
    store.set('k', { value: 1 }, 50);
    assert.deepEqual(store.get('k'), { value: 1 });
    await new Promise((resolve) => setTimeout(resolve, 200));
    assert.equal(store.get('k'), undefined);
  });

  it('persists entries to disk and reloads unexpired ones', async () => {
    const file = tempCacheFile();
    const store = createFileCacheStore({ file, logger: silentLogger });
    store.set('trading', { trades: [{ id: 't1' }] }, 60_000);
    await store.flush();

    const reloaded = createFileCacheStore({ file, logger: silentLogger });
    assert.deepEqual(reloaded.get('trading'), { trades: [{ id: 't1' }] });
    assert.match(readFileSync(file, 'utf8'), /trading/);
  });

  it('starts cold when the persisted cache is expired or unreadable', () => {
    const file = tempCacheFile();
    writeFileSync(file, JSON.stringify({ trading: { value: { trades: [] }, expiresAt: Date.now() - 1 } }));
    assert.equal(createFileCacheStore({ file, logger: silentLogger }).get('trading'), undefined);

    writeFileSync(file, 'not-json');
    assert.equal(createFileCacheStore({ file, logger: silentLogger }).get('trading'), undefined);
  });

  it('selects the configured store and falls back to memory', () => {
    const file = tempCacheFile();
    assert.equal(createCacheStore({ store: 'file', file, logger: silentLogger }).kind, 'file');
    assert.equal(createCacheStore({ store: 'memory' }).kind, 'memory');
    assert.equal(createCacheStore({ store: 'redis', logger: silentLogger }).kind, 'memory');
  });

  it('loads a shared cache provider module when configured', () => {
    const modulePath = tempSharedModule();
    const store = createCacheStore({ store: 'shared', sharedModule: modulePath, logger: silentLogger });
    store.set('k', { value: 1 }, 60_000);
    assert.equal(store.kind, 'shared');
    assert.deepEqual(store.get('k'), { value: 1 });
  });

  it('falls back to memory when shared cache provider is unavailable', () => {
    const store = createCacheStore({ store: 'shared', sharedModule: '/tmp/not-found.cjs', logger: silentLogger });
    assert.equal(store.kind, 'memory');
  });

  it('reuses a persisted cache across service instances and skips failed reads', async () => {
    const file = tempCacheFile();
    let positionCalls = 0;
    const connectors = () => ({
      openTrading: { listAccounts: async () => [], listTrades: async () => [], listOrders: async () => [] },
      portfolioWatcher: {
        listPositions: async () => {
          positionCalls += 1;
          return [{ position_id: 'p1', acct_id: 'acct-1', symbol: 'ABC', quantity: 1, avg_price: 10, last_price: 12, currency: 'USD' }];
        },
        listPerformanceSnapshots: async () => [],
      },
      taxBreak: { mapTradesToTaxEvents: async () => [], estimateTax: async () => ({ events: [] }) },
    });

    const options = { logger: silentLogger, cacheTtlMs: 60_000, cacheStore: createCacheStore({ store: 'file', file, logger: silentLogger }) };
    await createFinanceService({ ...options, connectors: connectors() }).portfolioOverview({});
    await options.cacheStore.flush();
    const second = await createFinanceService({
      logger: silentLogger,
      cacheTtlMs: 60_000,
      cacheStore: createCacheStore({ store: 'file', file, logger: silentLogger }),
      connectors: connectors(),
    }).portfolioOverview({});

    assert.equal(positionCalls, 1);
    assert.equal(second.positions.length, 1);
  });

  it('does not cache payloads that contain upstream errors', async () => {
    const store = createMemoryCacheStore();
    let calls = 0;
    const finance = createFinanceService({
      logger: silentLogger,
      cacheStore: store,
      cacheTtlMs: 60_000,
      connectors: {
        openTrading: {
          listAccounts: async () => {
            calls += 1;
            throw new UpstreamHttpError('OpenTrading', 'down', { status: 500, retryable: true });
          },
          listTrades: async () => [],
          listOrders: async () => [],
        },
        portfolioWatcher: { listPositions: async () => [], listPerformanceSnapshots: async () => [] },
        taxBreak: { mapTradesToTaxEvents: async () => [], estimateTax: async () => ({ events: [] }) },
      },
    });

    await finance.tradeHistory({});
    await finance.tradeHistory({});

    assert.equal(calls, 2);
  });
});
