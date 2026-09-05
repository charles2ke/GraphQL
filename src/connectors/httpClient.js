import { logger as defaultLogger } from '../observability/logger.js';
import { metrics as defaultMetrics } from '../observability/metrics.js';

/** Error carrying the upstream source and HTTP status for actionable messages. */
export class UpstreamHttpError extends Error {
  constructor(source, message, { status = null, retryable = false, kind = 'http' } = {}) {
    super(message);
    this.name = 'UpstreamHttpError';
    this.source = source;
    this.status = status;
    this.retryable = retryable;
    // `kind` distinguishes transport failures (timeout/network) from HTTP
    // responses so they can be classified without parsing the message.
    this.kind = kind;
  }
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** A 5xx or 429 response is worth retrying; client errors are not. */
function isRetryableStatus(status) {
  return status === 429 || status >= 500;
}

/**
 * Shared HTTP client for production connectors.
 *
 * Adds the pieces a real upstream call needs but a mock does not: bearer
 * authentication, request timeouts, bounded retries with backoff, structured
 * logging, and latency/outcome metrics.
 */
export function createHttpClient({
  source,
  endpoint,
  apiKey = '',
  timeoutMs = 5000,
  maxRetries = 2,
  retryBackoffMs = 100,
  fetchImpl = globalThis.fetch,
  logger = defaultLogger,
  metrics = defaultMetrics,
} = {}) {
  if (!endpoint) throw new Error(`${source} connector requires an endpoint`);
  if (typeof fetchImpl !== 'function') throw new Error(`${source} connector requires a fetch implementation`);

  const baseUrl = endpoint.endsWith('/') ? endpoint.slice(0, -1) : endpoint;

  async function once(path, { method = 'GET', body, signal } = {}) {
    const headers = { accept: 'application/json' };
    if (apiKey) headers.authorization = ['Bearer', apiKey].join(' ');
    if (body !== undefined) headers['content-type'] = 'application/json';

    const response = await fetchImpl(`${baseUrl}${path}`, {
      method,
      headers,
      signal,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (!response.ok) {
      throw new UpstreamHttpError(source, `HTTP ${response.status} from ${path}`, {
        status: response.status,
        retryable: isRetryableStatus(response.status),
      });
    }

    return response.json();
  }

  async function request(path, options = {}) {
    return metrics.time('finance_upstream_request', { source, path }, async () => {
      let lastError;

      for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeoutMs);

        try {
          return await once(path, { ...options, signal: controller.signal });
        } catch (error) {
          if (error instanceof UpstreamHttpError) {
            lastError = error;
          } else {
            const timedOut = error?.name === 'AbortError';
            lastError = new UpstreamHttpError(
              source,
              timedOut ? `request to ${path} timed out after ${timeoutMs}ms` : String(error?.message ?? error),
              { retryable: true, kind: timedOut ? 'timeout' : 'network' }
            );
          }

          metrics.increment('finance_upstream_attempt_failures_total', { source, path, kind: lastError.kind });
          logger.warn('upstream request failed', {
            source,
            path,
            attempt: attempt + 1,
            status: lastError.status,
            error: lastError.message,
          });

          if (!lastError.retryable || attempt === maxRetries) break;
          await sleep(retryBackoffMs * 2 ** attempt);
        } finally {
          clearTimeout(timer);
        }
      }

      throw lastError;
    });
  }

  return {
    source,
    endpoint: baseUrl,
    request,
    /** Lightweight readiness probe used by the /ready endpoint. */
    async health() {
      try {
        await request('/health');
        return { source, status: 'ok', endpoint: baseUrl };
      } catch (error) {
        return { source, status: 'degraded', endpoint: baseUrl, error: error.message };
      }
    },
  };
}
