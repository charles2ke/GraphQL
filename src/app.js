import { createServer } from 'node:http';

import { ApolloServerPluginDrainHttpServer } from '@apollo/server/plugin/drainHttpServer';
import { expressMiddleware } from '@as-integrations/express5';
import cors from 'cors';
import express from 'express';
import { NoSchemaIntrospectionCustomRule } from 'graphql';

import { loadCorsOptions } from './config/cors.js';
import { loadServerConfig } from './config/server.js';
import { store as defaultStore } from './data/store.js';
import { createExportRouter } from './export/router.js';
import { logger as defaultLogger } from './observability/logger.js';
import { metrics as defaultMetrics } from './observability/metrics.js';
import { requestIdMiddleware } from './observability/requestId.js';
import { createSchema } from './schema.js';
import { financeService } from './services/financeService.js';
import { createApolloServer } from './server.js';
import { pubsub as defaultPubsub } from './streaming/pubsub.js';
import { createStreamRouter } from './streaming/sseRouter.js';
import { createDepthLimitRule } from './validation/depthLimit.js';

// Extra time on top of the drain period before the process is force-exited.
const FORCE_EXIT_MARGIN_MS = 5000;
// One Ctrl+C can reach the server more than once: the terminal signals the
// whole process group and `node --watch` (npm run dev) forwards it again.
const REPEAT_SIGNAL_WINDOW_MS = 1000;

/**
 * Returns a SIGTERM/SIGINT listener that runs `shutdown()` once. A further
 * signal skips the drain and exits with code 1, unless it arrives within
 * REPEAT_SIGNAL_WINDOW_MS of the first: that is a duplicate delivery of the
 * same Ctrl+C rather than a deliberate second one, so it is ignored.
 */
export function createSignalHandler({
  shutdown,
  shutdownTimeoutMs,
  logger = defaultLogger,
  exit = (code) => process.exit(code),
  now = () => performance.now(),
}) {
  let firstSignalAt = null;

  return async function onSignal(signal) {
    if (firstSignalAt !== null) {
      if (now() - firstSignalAt < REPEAT_SIGNAL_WINDOW_MS) return;
      logger.warn('forced shutdown', { signal });
      exit(1);
      return;
    }
    firstSignalAt = now();
    logger.info('shutting down', { signal, timeoutMs: shutdownTimeoutMs });

    // Backstop in case a handle keeps the event loop alive after the drain.
    setTimeout(() => {
      logger.error('shutdown timed out, forcing exit', { signal });
      exit(1);
    }, shutdownTimeoutMs + FORCE_EXIT_MARGIN_MS).unref();

    try {
      await shutdown();
      logger.info('shutdown complete', { signal });
    } catch (error) {
      logger.error('shutdown failed', { signal, error: error?.message ?? String(error) });
      process.exitCode = 1;
    }
  };
}

/**
 * Wires the HTTP server: probes, metrics, /export, /graphql/stream and
 * /graphql. Nothing listens yet, so tests can boot the exact production
 * wiring on an ephemeral port.
 *
 * `shutdown()` is idempotent: it ends open SSE streams, stops accepting
 * connections, lets in-flight requests finish (forcing sockets closed after
 * `config.shutdownTimeoutMs`) and finally flushes the finance cache.
 */
export async function createApp({
  config = loadServerConfig(),
  // Cross-origin access is restricted to the CORS_ALLOWED_ORIGINS allow-list so
  // a malicious page can never read GraphQL or export responses.
  corsOptions = loadCorsOptions(),
  store = defaultStore,
  finance = financeService,
  logger = defaultLogger,
  metrics = defaultMetrics,
  pubsub = defaultPubsub,
} = {}) {
  const schema = createSchema();
  const app = express();
  const httpServer = createServer(app);
  const shutdownController = new AbortController();

  const validationRules = [createDepthLimitRule(config.maxQueryDepth)];

  const apolloServer = createApolloServer({
    schema,
    logger,
    metrics,
    enableObservability: true,
    introspection: config.introspection,
    validationRules,
    // Signals are handled by the caller so streams and caches shut down too.
    stopOnTerminationSignals: false,
    plugins: [ApolloServerPluginDrainHttpServer({ httpServer, stopGracePeriodMillis: config.shutdownTimeoutMs })],
  });
  await apolloServer.start();

  // Every request shares the same in-memory store; the logger is scoped to
  // the request so resolver logs can be correlated with access logs.
  const createContext = (req) => ({
    store,
    finance,
    metrics,
    pubsub,
    requestId: req.requestId,
    logger: logger.child?.({ requestId: req.requestId }) ?? logger,
  });

  // Every response carries an X-Request-Id (a well-formed incoming one is reused).
  app.use(requestIdMiddleware());

  // Liveness probe: the process is up and serving.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Readiness probe: reports per-upstream connector status so a degraded
  // finance cluster is visible without inspecting logs.
  app.get('/ready', async (_req, res) => {
    const health = await finance.health();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  // Prometheus-style scrape endpoint for connector and GraphQL metrics.
  app.get('/metrics', (_req, res) => {
    res.set('content-type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
  });

  // Spreadsheet downloads (.xlsx) for the same data the GraphQL API serves.
  app.use('/export', cors(corsOptions), createExportRouter({ store, finance, logger }));

  // Streaming endpoint (Server-Sent Events) for subscriptions and one-shot
  // operations, mounted before /graphql so it keeps its own body parsing.
  app.use(
    '/graphql/stream',
    cors(corsOptions),
    express.json(),
    createStreamRouter({
      schema,
      logger,
      metrics,
      // Apollo disables introspection itself; the stream endpoint must match.
      validationRules: config.introspection ? validationRules : [...validationRules, NoSchemaIntrospectionCustomRule],
      shutdownSignal: shutdownController.signal,
      contextValue: ({ req }) => createContext(req),
    })
  );

  app.use(
    '/graphql',
    cors(corsOptions),
    express.json(),
    expressMiddleware(apolloServer, { context: async ({ req }) => createContext(req) })
  );

  let stopping;
  function shutdown() {
    stopping ??= (async () => {
      shutdownController.abort();
      // Drains the HTTP server via ApolloServerPluginDrainHttpServer.
      await apolloServer.stop();
      await finance.close?.();
    })();
    return stopping;
  }

  return { app, httpServer, apolloServer, shutdown };
}
