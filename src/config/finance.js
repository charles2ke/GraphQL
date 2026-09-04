/** Environment-driven configuration for finance-cluster connectors. */
export function loadFinanceConfig(env = process.env) {
  const timeoutMs = Number(env.FINANCE_HTTP_TIMEOUT_MS ?? 5000);
  const maxRetries = Number(env.FINANCE_HTTP_MAX_RETRIES ?? 2);

  return {
    openTrading: {
      endpoint: env.OPENTRADING_ENDPOINT ?? 'mock://opentrading',
      apiKey: env.OPENTRADING_API_KEY ?? '',
      timeoutMs,
      maxRetries,
    },
    portfolioWatcher: {
      endpoint: env.PORTFOLIO_WATCHER_ENDPOINT ?? 'mock://portfolio-watcher',
      apiKey: env.PORTFOLIO_WATCHER_API_KEY ?? '',
      timeoutMs,
      maxRetries,
    },
    taxBreak: {
      endpoint: env.TAX_BREAK_ENDPOINT ?? 'mock://tax-break',
      apiKey: env.TAX_BREAK_API_KEY ?? '',
      timeoutMs,
      maxRetries,
    },
    cacheTtlMs: Number(env.FINANCE_CACHE_TTL_MS ?? 1000),
    defaultPageSize: Number(env.FINANCE_DEFAULT_PAGE_SIZE ?? 25),
    maxPageSize: Number(env.FINANCE_MAX_PAGE_SIZE ?? 100),
  };
}
