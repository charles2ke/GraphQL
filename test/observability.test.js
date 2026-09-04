import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { createLogger } from '../src/observability/logger.js';
import { createMetrics } from '../src/observability/metrics.js';
import { createObservabilityPlugin } from '../src/observability/apolloPlugin.js';

describe('structured logging', () => {
  it('emits JSON lines, redacts credentials, and respects the level threshold', () => {
    const lines = [];
    const logger = createLogger({ level: 'info', write: (line) => lines.push(line) });

    logger.debug('ignored');
    logger.info('connector configured', { connector: 'openTrading', apiKey: 'super-secret' });

    assert.equal(lines.length, 1);
    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'info');
    assert.equal(entry.message, 'connector configured');
    assert.equal(entry.connector, 'openTrading');
    assert.equal(entry.apiKey, '[redacted]');
  });
});

describe('metrics registry', () => {
  it('records counters, latency summaries, and Prometheus output', async () => {
    const metrics = createMetrics();

    metrics.increment('finance_cache_total', { key: 'trading', outcome: 'hit' });
    metrics.increment('finance_cache_total', { key: 'trading', outcome: 'hit' });
    await metrics.time('finance_connector_call', { source: 'OpenTrading' }, async () => 'ok');
    await assert.rejects(() =>
      metrics.time('finance_connector_call', { source: 'OpenTrading' }, async () => {
        throw new Error('boom');
      })
    );

    const snapshot = metrics.snapshot();
    const hits = snapshot.counters.find((counter) => counter.name === 'finance_cache_total');
    assert.equal(hits.value, 2);
    assert.equal(snapshot.durations.filter((duration) => duration.name === 'finance_connector_call_duration_ms').length, 2);

    const text = metrics.toPrometheus();
    assert.match(text, /finance_cache_total\{key="trading",outcome="hit"\} 2/);
    assert.match(text, /finance_connector_call_duration_ms_count/);

    metrics.reset();
    assert.deepEqual(metrics.snapshot().counters, []);
  });
});

describe('graphql observability plugin', () => {
  async function run(plugin, requestContext) {
    const hooks = await plugin.requestDidStart(requestContext);
    await hooks.willSendResponse(requestContext);
  }

  it('logs and measures successful operations', async () => {
    const lines = [];
    const metrics = createMetrics();
    const plugin = createObservabilityPlugin({ logger: createLogger({ write: (line) => lines.push(line) }), metrics });

    await run(plugin, { request: {}, operationName: 'PortfolioOverview', operation: { operation: 'query' }, errors: [] });

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.operationName, 'PortfolioOverview');
    assert.equal(entry.outcome, 'success');
    assert.equal(typeof entry.durationMs, 'number');

    const counter = metrics.snapshot().counters.find((item) => item.name === 'graphql_operation_total');
    assert.equal(counter.labels.outcome, 'success');
  });

  it('logs failures with error codes and counts them', async () => {
    const lines = [];
    const metrics = createMetrics();
    const plugin = createObservabilityPlugin({ logger: createLogger({ write: (line) => lines.push(line) }), metrics });

    await run(plugin, {
      request: { http: { headers: new Map([['x-request-id', 'req-1']]) } },
      operationName: 'CreatePost',
      operation: { operation: 'mutation' },
      errors: [{ extensions: { code: 'BAD_USER_INPUT' } }],
    });

    const entry = JSON.parse(lines[0]);
    assert.equal(entry.level, 'error');
    assert.equal(entry.requestId, 'req-1');
    assert.deepEqual(entry.errorCodes, ['BAD_USER_INPUT']);

    const errorCounter = metrics.snapshot().counters.find((item) => item.name === 'graphql_operation_errors_total');
    assert.equal(errorCounter.value, 1);
  });
});
