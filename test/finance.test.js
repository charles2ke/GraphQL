import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  aggregatePortfolio,
  estimateTaxFromEvents,
  filterTrades,
  normalizeAccount,
  normalizePosition,
  normalizeTrade,
  paginate,
  tradeToTaxEvent,
  withinRange,
} from '../src/domain/finance.js';
import { loadFinanceConfig } from '../src/config/finance.js';
import { createFinanceService } from '../src/services/financeService.js';

describe('finance domain normalization', () => {
  it('normalizes inconsistent upstream account and position fields', () => {
    const account = normalizeAccount({ acct_id: 7, display_name: 'IRA', account_type: 'RETIREMENT', base_currency: 'EUR', source: 'OpenTrading' });
    assert.deepEqual(account, { id: '7', name: 'IRA', type: 'RETIREMENT', currency: 'EUR', provider: 'OpenTrading' });

    const position = normalizePosition({ account_id: 'acct-1', ticker: 'msft', qty: 5, cost_basis_per_share: 100, last_price: 120 });
    assert.equal(position.id, 'acct-1:msft');
    assert.equal(position.symbol, 'MSFT');
    assert.equal(position.marketValue, 600);
    assert.equal(position.unrealizedPnL, 100);
  });

  it('normalizes trades and derives tax events for sells and buys', () => {
    const trade = normalizeTrade({
      trade_id: 't-1',
      acct_id: 'acct-1',
      order_ref: 'o-1',
      ticker: 'aapl',
      action: 'sell',
      qty: 4,
      avg_px: 180,
      trade_time: '2026-04-05T15:45:00.000Z',
      fills: [{ fill_id: 'f-1', fill_qty: 4, fill_px: 180, filled_at: '2026-04-05T15:45:00.000Z' }],
    });

    assert.equal(trade.side, 'SELL');
    assert.equal(trade.symbol, 'AAPL');
    assert.equal(trade.fills.length, 1);

    const sellEvent = tradeToTaxEvent(trade);
    assert.equal(sellEvent.tradeId, 't-1');
    assert.equal(sellEvent.proceeds, 720);
    assert.equal(sellEvent.realizedGain, 129.6);

    const buyEvent = tradeToTaxEvent({ ...trade, id: 't-2', side: 'BUY' });
    assert.equal(buyEvent.proceeds, 0);
    assert.equal(buyEvent.realizedGain, -720);
  });
});

describe('finance aggregation', () => {
  it('sums market value and unrealized P/L across positions', () => {
    const overview = aggregatePortfolio({
      accounts: [{ id: 'acct-1', currency: 'USD' }],
      positions: [
        { marketValue: 1000, unrealizedPnL: 100 },
        { marketValue: 145.5, unrealizedPnL: -5.5 },
      ],
    });

    assert.equal(overview.currency, 'USD');
    assert.equal(overview.totalMarketValue, 1145.5);
    assert.equal(overview.totalUnrealizedPnL, 94.5);
    assert.deepEqual(overview.errors, []);
  });

  it('filters trades by account and symbol and estimates tax for a single year', () => {
    const trades = [
      { accountId: 'acct-1', symbol: 'AAPL' },
      { accountId: 'acct-2', symbol: 'AAPL' },
      { accountId: 'acct-1', symbol: 'MSFT' },
    ];

    assert.equal(filterTrades(trades, { accountId: 'acct-1' }).length, 2);
    assert.equal(filterTrades(trades, { accountId: 'acct-1', symbol: 'aapl' }).length, 1);

    const estimate = estimateTaxFromEvents(
      [
        { proceeds: 720, costBasis: 590.4, realizedGain: 129.6, occurredAt: '2026-04-05T15:45:00.000Z' },
        { proceeds: 100, costBasis: 50, realizedGain: 50, occurredAt: '2025-04-05T15:45:00.000Z' },
      ],
      2026
    );

    assert.equal(estimate.events.length, 1);
    assert.equal(estimate.realizedGain, 129.6);
    assert.equal(estimate.estimatedTax, 28.51);
  });
});

describe('finance service configuration and batching', () => {
  it('reads endpoints and cache TTL from the environment with mock defaults', () => {
    const defaults = loadFinanceConfig({});
    assert.equal(defaults.openTrading.endpoint, 'mock://opentrading');
    assert.equal(defaults.cacheTtlMs, 1000);

    const configured = loadFinanceConfig({ OPENTRADING_ENDPOINT: 'https://trading.example', FINANCE_CACHE_TTL_MS: '5000' });
    assert.equal(configured.openTrading.endpoint, 'https://trading.example');
    assert.equal(configured.cacheTtlMs, 5000);
  });

  it('shares a single upstream call between concurrent and cached requests', async () => {
    let accountCalls = 0;
    const finance = createFinanceService({
      cacheTtlMs: 60_000,
      connectors: {
        openTrading: {
          listAccounts: async () => {
            accountCalls += 1;
            return [{ acct_id: 'acct-1', display_name: 'Primary', source: 'OpenTrading' }];
          },
          listTrades: async () => [],
          listOrders: async () => [],
        },
        portfolioWatcher: {
          listPositions: async () => [],
          listPerformanceSnapshots: async () => [],
        },
        taxBreak: {
          mapTradesToTaxEvents: async () => [],
          estimateTax: async () => ({}),
        },
      },
    });

    await Promise.all([finance.portfolioOverview(), finance.portfolioOverview()]);
    await finance.portfolioOverview();

    assert.equal(accountCalls, 1);
  });
});

describe('finance filtering and pagination', () => {
  const trades = [
    { id: 't-1', accountId: 'acct-1', symbol: 'AAPL', side: 'BUY', status: 'FILLED', executedAt: '2026-01-10T14:31:00.000Z' },
    { id: 't-2', accountId: 'acct-1', symbol: 'AAPL', side: 'SELL', status: 'FILLED', executedAt: '2026-04-05T15:45:00.000Z' },
    { id: 't-3', accountId: 'acct-2', symbol: 'MSFT', side: 'SELL', status: 'CANCELLED', executedAt: '2025-12-01T10:00:00.000Z' },
  ];

  it('filters trades by side, status, and an inclusive date range', () => {
    assert.deepEqual(filterTrades(trades, { side: 'sell' }).map((trade) => trade.id), ['t-2', 't-3']);
    assert.deepEqual(filterTrades(trades, { status: 'cancelled' }).map((trade) => trade.id), ['t-3']);
    assert.deepEqual(
      filterTrades(trades, { from: '2026-01-01T00:00:00.000Z', to: '2026-02-01T00:00:00.000Z' }).map((trade) => trade.id),
      ['t-1']
    );
    assert.equal(withinRange('2026-01-10T14:31:00.000Z', { from: '2026-01-10T14:31:00.000Z' }), true);
    assert.equal(withinRange('not-a-date', { from: '2026-01-01T00:00:00.000Z' }), false);
  });

  it('paginates with clamped limits and reports page metadata', () => {
    const first = paginate(trades, { limit: 2, offset: 0 });
    assert.deepEqual(first.items.map((trade) => trade.id), ['t-1', 't-2']);
    assert.deepEqual(first.pageInfo, { totalCount: 3, limit: 2, offset: 0, hasNextPage: true, hasPreviousPage: false });

    const second = paginate(trades, { limit: 2, offset: 2 });
    assert.deepEqual(second.items.map((trade) => trade.id), ['t-3']);
    assert.equal(second.pageInfo.hasNextPage, false);
    assert.equal(second.pageInfo.hasPreviousPage, true);

    const clamped = paginate(trades, { limit: 500, offset: -5 }, { defaultLimit: 25, maxLimit: 2 });
    assert.equal(clamped.pageInfo.limit, 2);
    assert.equal(clamped.pageInfo.offset, 0);

    const defaulted = paginate(trades, {}, { defaultLimit: 1, maxLimit: 10 });
    assert.equal(defaulted.items.length, 1);
  });
});

describe('finance service health', () => {
  it('aggregates upstream connector health', async () => {
    const finance = createFinanceService({
      connectors: {
        openTrading: { source: 'OpenTrading', health: async () => ({ source: 'OpenTrading', status: 'ok' }) },
        portfolioWatcher: {
          source: 'Portfolio-Watcher',
          health: async () => {
            throw new Error('probe failed');
          },
        },
        taxBreak: { source: 'tax-break', health: async () => ({ source: 'tax-break', status: 'ok' }) },
      },
    });

    const health = await finance.health();
    assert.equal(health.status, 'degraded');
    assert.equal(health.upstreams.find((check) => check.source === 'Portfolio-Watcher').status, 'degraded');
  });
});
