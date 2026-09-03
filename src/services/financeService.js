import { createOpenTradingConnector } from '../connectors/opentrading/mockConnector.js';
import { createPortfolioWatcherConnector } from '../connectors/portfolio-watcher/mockConnector.js';
import { createTaxBreakConnector } from '../connectors/tax-break/mockConnector.js';
import { loadFinanceConfig } from '../config/finance.js';
import {
  aggregatePortfolio,
  estimateTaxFromEvents,
  filterByAccount,
  filterTrades,
  normalizeAccount,
  normalizeOrder,
  normalizePerformanceSnapshot,
  normalizePosition,
  normalizeTrade,
} from '../domain/finance.js';

function upstreamError(source, error) {
  const message = error instanceof Error ? error.message : String(error);
  return {
    source,
    code: 'UPSTREAM_UNAVAILABLE',
    message: `${source} connector failed: ${message}`,
  };
}

async function capture(source, task) {
  try {
    return { data: await task(), error: null };
  } catch (error) {
    return { data: [], error: upstreamError(source, error) };
  }
}

export function createFinanceService({ config = loadFinanceConfig(), connectors, cacheTtlMs = config.cacheTtlMs } = {}) {
  const upstreams = connectors ?? {
    openTrading: createOpenTradingConnector(config.openTrading),
    portfolioWatcher: createPortfolioWatcherConnector(config.portfolioWatcher),
    taxBreak: createTaxBreakConnector(config.taxBreak),
  };
  const cache = new Map();
  // Concurrent resolvers asking for the same upstream data share a single
  // in-flight request instead of fanning out duplicate connector calls.
  const inFlight = new Map();

  async function cached(key, load) {
    const now = Date.now();
    const hit = cache.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const pending = inFlight.get(key);
    if (pending) return pending;

    const request = (async () => {
      try {
        const value = await load();
        cache.set(key, { value, expiresAt: Date.now() + cacheTtlMs });
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
        capture('OpenTrading', () => upstreams.openTrading.listAccounts()),
        capture('OpenTrading', () => upstreams.openTrading.listTrades()),
        capture('OpenTrading', () => upstreams.openTrading.listOrders()),
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
        capture('Portfolio-Watcher', () => upstreams.portfolioWatcher.listPositions()),
        capture('Portfolio-Watcher', () => upstreams.portfolioWatcher.listPerformanceSnapshots()),
      ]);

      return {
        positions: positions.data.map(normalizePosition),
        snapshots: snapshots.data.map(normalizePerformanceSnapshot),
        errors: [positions.error, snapshots.error].filter(Boolean),
      };
    });
  }

  async function mapTaxEvents(trades) {
    const mapped = await capture('tax-break', () => upstreams.taxBreak.mapTradesToTaxEvents(trades));
    return { events: mapped.data, errors: mapped.error ? [mapped.error] : [] };
  }

  return {
    async portfolioOverview({ accountId } = {}) {
      const [trading, portfolio] = await Promise.all([getTradingData(), getPortfolioData()]);

      return aggregatePortfolio({
        accounts: accountId ? trading.accounts.filter((account) => account.id === accountId) : trading.accounts,
        positions: filterByAccount(portfolio.positions, accountId),
        snapshots: filterByAccount(portfolio.snapshots, accountId),
        errors: [...trading.errors, ...portfolio.errors],
      });
    },

    async tradeHistory({ accountId, symbol } = {}) {
      const trading = await getTradingData();
      const trades = filterTrades(trading.trades, { accountId, symbol });
      const orders = filterByAccount(trading.orders, accountId).filter((order) => (symbol ? order.symbol === symbol.toUpperCase() : true));
      const taxEvents = await mapTaxEvents(trades);

      return {
        trades,
        orders,
        taxEvents: taxEvents.events,
        errors: [...trading.errors, ...taxEvents.errors],
      };
    },

    async taxEstimate({ taxYear, accountId } = {}) {
      const history = await this.tradeHistory({ accountId });
      const estimate = await capture('tax-break', () => upstreams.taxBreak.estimateTax({ events: history.taxEvents, taxYear }));
      const fallback = estimate.error ? estimateTaxFromEvents(history.taxEvents, taxYear) : null;

      return {
        ...(estimate.error ? fallback : estimate.data),
        events: estimate.error ? fallback.events : estimate.data.events,
        errors: [...history.errors, estimate.error].filter(Boolean),
      };
    },
  };
}

export const financeService = createFinanceService();
