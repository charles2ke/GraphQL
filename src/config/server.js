/** Environment-driven HTTP server settings. */

export const DEFAULT_MAX_QUERY_DEPTH = 10;
export const DEFAULT_SHUTDOWN_TIMEOUT_MS = 10_000;

const parsePositiveInt = (value, fallback) => {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
};

export function loadServerConfig(env = process.env) {
  return {
    port: Number(env.PORT) || 4000,
    // Operations nesting fields deeper than this are rejected before execution.
    maxQueryDepth: parsePositiveInt(env.GRAPHQL_MAX_DEPTH, DEFAULT_MAX_QUERY_DEPTH),
    // Mirrors Apollo Server's default so /graphql and /graphql/stream agree.
    introspection: env.NODE_ENV !== 'production',
    // How long in-flight requests may run after SIGTERM/SIGINT before their sockets are closed.
    shutdownTimeoutMs: parsePositiveInt(env.SHUTDOWN_TIMEOUT_MS, DEFAULT_SHUTDOWN_TIMEOUT_MS),
  };
}
