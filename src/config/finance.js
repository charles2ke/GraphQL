/** Environment-driven configuration for finance-cluster connectors. */
export function loadFinanceConfig(env = process.env) {
  return {
    openTrading: {
      endpoint: env.OPENTRADING_ENDPOINT ?? 'mock://opentrading',
      apiKey: env.OPENTRADING_API_KEY ?? '',
    },
    portfolioWatcher: {
      endpoint: env.PORTFOLIO_WATCHER_ENDPOINT ?? 'mock://portfolio-watcher',
      apiKey: env.PORTFOLIO_WATCHER_API_KEY ?? '',
    },
    taxBreak: {
      endpoint: env.TAX_BREAK_ENDPOINT ?? 'mock://tax-break',
      apiKey: env.TAX_BREAK_API_KEY ?? '',
    },
    cacheTtlMs: Number(env.FINANCE_CACHE_TTL_MS ?? 1000),
  };
}
