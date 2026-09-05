import { loadFinanceConfig } from '../config/finance.js';
import { logger as defaultLogger } from '../observability/logger.js';
import { metrics as defaultMetrics } from '../observability/metrics.js';
import { createOpenTradingConnector } from './opentrading/mockConnector.js';
import { createOpenTradingHttpConnector } from './opentrading/httpConnector.js';
import { createPortfolioWatcherConnector } from './portfolio-watcher/mockConnector.js';
import { createPortfolioWatcherHttpConnector } from './portfolio-watcher/httpConnector.js';
import { createTaxBreakConnector } from './tax-break/mockConnector.js';
import { createTaxBreakHttpConnector } from './tax-break/httpConnector.js';
import { UpstreamHttpError } from './httpClient.js';

/** Mock endpoints keep the service runnable from a clean checkout. */
export function isMockEndpoint(endpoint = '') {
  return endpoint.startsWith('mock://');
}

const FACTORIES = {
  openTrading: { mock: createOpenTradingConnector, http: createOpenTradingHttpConnector },
  portfolioWatcher: { mock: createPortfolioWatcherConnector, http: createPortfolioWatcherHttpConnector },
  taxBreak: { mock: createTaxBreakConnector, http: createTaxBreakHttpConnector },
};

const CONNECTOR_METHODS = {
  openTrading: ['listAccounts', 'listTrades', 'listOrders'],
  portfolioWatcher: ['listPositions', 'listPerformanceSnapshots'],
  taxBreak: ['mapTradesToTaxEvents', 'estimateTax'],
};

function createAuthMisconfiguredConnector(name, endpoint) {
  const source = name === 'portfolioWatcher' ? 'Portfolio-Watcher' : name === 'taxBreak' ? 'tax-break' : 'OpenTrading';
  const buildError = () =>
    new UpstreamHttpError(source, `${source} connector is missing API credentials`, { kind: 'auth', retryable: false });

  return {
    source,
    endpoint,
    async health() {
      return { source, status: 'degraded', endpoint, error: 'missing API credentials' };
    },
    ...Object.fromEntries(CONNECTOR_METHODS[name].map((method) => [method, async () => Promise.reject(buildError())])),
  };
}

/**
 * Builds one connector per upstream domain, choosing the production HTTP client
 * whenever a real endpoint is configured and falling back to the mock adapter
 * for `mock://` endpoints.
 */
export function createConnectors({
  config = loadFinanceConfig(),
  logger = defaultLogger,
  metrics = defaultMetrics,
  fetchImpl,
} = {}) {
  return Object.fromEntries(
    Object.entries(FACTORIES).map(([name, factory]) => {
      const settings = config[name] ?? {};
      const mode = isMockEndpoint(settings.endpoint) ? 'mock' : 'http';

      // Live wiring is worth an info line; mock wiring stays at debug so test
      // runs and local demos are not noisy.
      logger[mode === 'http' ? 'info' : 'debug']('finance connector configured', { connector: name, mode, endpoint: settings.endpoint });

      if (mode === 'http' && !settings.apiKey) {
        logger.error('finance connector missing credentials', { connector: name, endpoint: settings.endpoint });
        return [name, createAuthMisconfiguredConnector(name, settings.endpoint)];
      }

      return [
        name,
        mode === 'mock'
          ? factory.mock(settings)
          : factory.http({ ...settings, logger, metrics, ...(fetchImpl ? { fetchImpl } : {}) }),
      ];
    })
  );
}
