/**
 * Upstream failure classification.
 *
 * Resolvers, metrics and clients all benefit from a stable category instead of
 * a raw message: dashboards can alert on `AUTH` or `RATE_LIMIT` separately from
 * generic outages, and callers can decide whether a retry is worthwhile.
 */
export const ERROR_CATEGORIES = {
  VALIDATION: 'VALIDATION',
  AUTH: 'AUTH',
  RATE_LIMIT: 'RATE_LIMIT',
  TIMEOUT: 'TIMEOUT',
  NETWORK: 'NETWORK',
  UPSTREAM_CLIENT_ERROR: 'UPSTREAM_CLIENT_ERROR',
  UPSTREAM_SERVER_ERROR: 'UPSTREAM_SERVER_ERROR',
  UNKNOWN: 'UNKNOWN',
};

function categoryFromStatus(status) {
  if (status === 401 || status === 403) return ERROR_CATEGORIES.AUTH;
  if (status === 429) return ERROR_CATEGORIES.RATE_LIMIT;
  if (status === 408 || status === 504) return ERROR_CATEGORIES.TIMEOUT;
  if (status >= 500) return ERROR_CATEGORIES.UPSTREAM_SERVER_ERROR;
  if (status >= 400) return ERROR_CATEGORIES.UPSTREAM_CLIENT_ERROR;
  return ERROR_CATEGORIES.UNKNOWN;
}

function categoryFromError(error) {
  if (error?.kind === 'auth') return ERROR_CATEGORIES.AUTH;
  if (error?.kind === 'timeout' || error?.name === 'AbortError') return ERROR_CATEGORIES.TIMEOUT;
  if (error?.kind === 'network') return ERROR_CATEGORIES.NETWORK;
  return ERROR_CATEGORIES.UNKNOWN;
}

/** Categories that are transient and therefore worth retrying. */
const RETRYABLE = new Set([
  ERROR_CATEGORIES.RATE_LIMIT,
  ERROR_CATEGORIES.TIMEOUT,
  ERROR_CATEGORIES.NETWORK,
  ERROR_CATEGORIES.UPSTREAM_SERVER_ERROR,
]);

/**
 * Converts any thrown value into the `FinanceUpstreamError` shape exposed by
 * the schema.
 */
export function classifyUpstreamError(source, error) {
  const status = Number.isInteger(error?.status) ? error.status : null;
  const category = status === null ? categoryFromError(error) : categoryFromStatus(status);
  const messageByCategory = {
    [ERROR_CATEGORIES.AUTH]: `${source} connector authentication failed`,
    [ERROR_CATEGORIES.RATE_LIMIT]: `${source} connector rate limit exceeded`,
    [ERROR_CATEGORIES.TIMEOUT]: `${source} connector request timed out`,
    [ERROR_CATEGORIES.NETWORK]: `${source} connector network error`,
    [ERROR_CATEGORIES.UPSTREAM_CLIENT_ERROR]: `${source} connector request rejected`,
    [ERROR_CATEGORIES.UPSTREAM_SERVER_ERROR]: `${source} connector is unavailable`,
    [ERROR_CATEGORIES.UNKNOWN]: `${source} connector request failed`,
  };

  return {
    source,
    code: status === null ? `UPSTREAM_${category}` : `UPSTREAM_HTTP_${status}`,
    category,
    status,
    retryable: typeof error?.retryable === 'boolean' ? error.retryable : RETRYABLE.has(category),
    message: status === null ? messageByCategory[category] : `${messageByCategory[category]} (HTTP ${status})`,
  };
}
