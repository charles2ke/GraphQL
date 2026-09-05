import { createCacheStore } from '../cache/index.js';
import { createConnectors } from '../connectors/index.js';
import { loadFinanceConfig } from '../config/finance.js';
import { classifyUpstreamError } from '../observability/errors.js';
import { logger as defaultLogger } from '../observability/logger.js';
import { metrics as defaultMetrics } from '../observability/metrics.js';
import {
  aggregatePortfolio,
  estimateTaxFromEvents,
  filterByAccount,
  filterOrders,
  filterSnapshots,
  filterTaxEvents,
  filterTrades,
  normalizeAccount,
  normalizeOrder,
  normalizePerformanceSnapshot,
  normalizePosition,
  normalizeTrade,
  paginate,
} from '../domain/finance.js';

export function createFinanceService({
  config = loadFinanceConfig(),
  connectors,
  cacheTtlMs = config.cacheTtlMs,
  cacheStore,
  logger = defaultLogger,
  metrics = defaultMetrics,
} = {}) {
  const upstreams = connectors ?? createConnectors({ config, logger, metrics });
  const pageLimits = { defaultLimit: config.defaultPageSize ?? 25, maxLimit: config.maxPageSize ?? 100 };
  const cache = cacheStore ?? createCacheStore({ store: config.cacheStore, file: config.cacheFile, sharedModule: config.cacheSharedModule, logger });
  // Concurrent resolvers asking for the same upstream data share a single
  // in-flight request instead of fanning out duplicate connector calls.
  const inFlight = new Map();

  /** Runs an upstream call, recording latency/outcome and converting failures. */
  async function capture(source, operation, task) {
    try {
      const data = await metrics.time('finance_connector_call', { source, operation }, task);
      return { data, error: null };
    } catch (error) {
      const classified = classifyUpstreamError(source, error);
      metrics.increment('finance_upstream_errors_total', {
        source,
        operation,
        category: classified.category,
        retryable: classified.retryable,
      });
      logger.error('finance connector call failed', {
        source,
        operation,
        category: classified.category,
        status: classified.status,
        retryable: classified.retryable,
        error: error?.message ?? String(error),
      });
      return { data: [], error: classified };
    }
  }

  async function cached(key, load) {
    const hit = cache.get(key);
    if (hit !== undefined) {
      metrics.increment('finance_cache_total', { key, outcome: 'hit', store: cache.kind });
      return hit;
    }

    const pending = inFlight.get(key);
    if (pending) {
      metrics.increment('finance_cache_total', { key, outcome: 'coalesced', store: cache.kind });
      return pending;
    }

    metrics.increment('finance_cache_total', { key, outcome: 'miss', store: cache.kind });

    const request = (async () => {
      try {
        const value = await load();
        // Failed upstream reads are not cached: a transient outage should not
        // pin an empty payload for the whole TTL.
        if ((value.errors ?? []).length === 0) cache.set(key, value, cacheTtlMs);
        return value;
      } finally {
        inFlight.delete(key);
      }
    })();

    inFlight.set(key, request);
    return request;
  }

  async function getTradingData() {
    return cached('trading', async () => {
      const [accounts, trades, orders] = await Promise.all([
        capture('OpenTrading', 'listAccounts', () => upstreams.openTrading.listAccounts()),
        capture('OpenTrading', 'listTrades', () => upstreams.openTrading.listTrades()),
        capture('OpenTrading', 'listOrders', () => upstreams.openTrading.listOrders()),
      ]);

      return {
        accounts: accounts.data.map(normalizeAccount),
        trades: trades.data.map(normalizeTrade),
        orders: orders.data.map(normalizeOrder),
        errors: [accounts.error, trades.error, orders.error].filter(Boolean),
      };
    });
  }

  async function getPortfolioData() {
    return cached('portfolio', async () => {
      const [positions, snapshots] = await Promise.all([
        capture('Portfolio-Watcher', 'listPositions', () => upstreams.portfolioWatcher.listPositions()),
        capture('Portfolio-Watcher', 'listPerformanceSnapshots', () => upstreams.portfolioWatcher.listPerformanceSnapshots()),
      ]);

      return {
        positions: positions.data.map(normalizePosition),
        snapshots: snapshots.data.map(normalizePerformanceSnapshot),
        errors: [positions.error, snapshots.error].filter(Boolean),
      };
    });
  }

  async function mapTaxEvents(trades) {
    const mapped = await capture('tax-break', 'mapTradesToTaxEvents', () => upstreams.taxBreak.mapTradesToTaxEvents(trades));
    return { events: mapped.data, errors: mapped.error ? [mapped.error] : [] };
  }

  /** Full (unpaginated) filtered trading history shared by tradeHistory and taxEstimate. */
  async function collectHistory(filter = {}) {
    const trading = await getTradingData();
    const trades = filterTrades(trading.trades, filter);
    const orders = filterOrders(trading.orders, filter);

    return {
      trades,
      orders,
      errors: [...trading.errors],
    };
  }

  return {
    async portfolioOverview({ accountId, from, to, limit, offset } = {}) {
      const [trading, portfolio] = await Promise.all([getTradingData(), getPortfolioData()]);
      const positions = paginate(filterByAccount(portfolio.positions, accountId), { limit, offset }, pageLimits);

      return {
        ...aggregatePortfolio({
          accounts: accountId ? trading.accounts.filter((account) => account.id === accountId) : trading.accounts,
          positions: positions.items,
          snapshots: filterSnapshots(filterByAccount(portfolio.snapshots, accountId), { from, to }),
          errors: [...trading.errors, ...portfolio.errors],
        }),
        pageInfo: positions.pageInfo,
      };
    },

    async tradeHistory({ limit, offset, ...filter } = {}) {
      const history = await collectHistory(filter);
      const trades = paginate(history.trades, { limit, offset }, pageLimits);
      const taxEvents = await mapTaxEvents(trades.items);
      const tradeIds = new Set(trades.items.map((trade) => trade.id));

      return {
        trades: trades.items,
        orders: paginate(history.orders, { limit, offset }, pageLimits).items,
        taxEvents: filterTaxEvents(taxEvents.events, filter).filter((event) => tradeIds.has(event.tradeId)),
        pageInfo: trades.pageInfo,
        errors: [...history.errors, ...taxEvents.errors],
      };
    },

    async taxEstimate({ taxYear, limit, offset, ...filter } = {}) {
      const history = await collectHistory(filter);
      const taxEvents = await mapTaxEvents(history.trades);
      const filteredEvents = filterTaxEvents(taxEvents.events, filter);
      const estimate = await capture('tax-break', 'estimateTax', () => upstreams.taxBreak.estimateTax({ events: filteredEvents, taxYear }));
      const summary = estimate.error ? estimateTaxFromEvents(filteredEvents, taxYear) : estimate.data;
      const events = paginate(summary.events ?? [], { limit, offset }, pageLimits);

      return {
        ...summary,
        events: events.items,
        pageInfo: events.pageInfo,
        errors: [...history.errors, ...taxEvents.errors, estimate.error].filter(Boolean),
      };
    },

    /** Aggregated upstream readiness used by the HTTP /ready endpoint. */
    async health() {
      const checks = await Promise.all(
        Object.values(upstreams).map(async (connector) => {
          if (typeof connector.health !== 'function') {
            return { source: connector.source ?? 'unknown', status: 'unknown' };
          }

          try {
            return await connector.health();
          } catch (error) {
            return { source: connector.source ?? 'unknown', status: 'degraded', error: error?.message ?? String(error) };
          }
        })
      );

      return {
        status: checks.every((check) => check.status === 'ok') ? 'ok' : 'degraded',
        upstreams: checks,
      };
    },
  };
}

export const financeService = createFinanceService();
