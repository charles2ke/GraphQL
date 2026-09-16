import { expressMiddleware } from '@as-integrations/express4';
import cors from 'cors';
import express from 'express';

import { loadCorsOptions } from './config/cors.js';
import { store } from './data/store.js';
import { createExportRouter } from './export/router.js';
import { logger } from './observability/logger.js';
import { metrics } from './observability/metrics.js';
import { createSchema } from './schema.js';
import { financeService } from './services/financeService.js';
import { createApolloServer } from './server.js';
import { pubsub } from './streaming/pubsub.js';
import { createStreamRouter } from './streaming/sseRouter.js';

const PORT = Number(process.env.PORT) || 4000;

/** Starts the HTTP server exposing the GraphQL endpoint at /graphql. */
async function main() {
  const schema = createSchema();
  const apolloServer = createApolloServer({ schema, logger, metrics, enableObservability: true });
  await apolloServer.start();

  const app = express();

  // Cross-origin access is restricted to the CORS_ALLOWED_ORIGINS allow-list so
  // a malicious page can never read GraphQL or export responses.
  const corsOptions = loadCorsOptions();

  // Liveness probe: the process is up and serving.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  // Readiness probe: reports per-upstream connector status so a degraded
  // finance cluster is visible without inspecting logs.
  app.get('/ready', async (_req, res) => {
    const health = await financeService.health();
    res.status(health.status === 'ok' ? 200 : 503).json(health);
  });

  // Prometheus-style scrape endpoint for connector and GraphQL metrics.
  app.get('/metrics', (_req, res) => {
    res.set('content-type', 'text/plain; version=0.0.4').send(metrics.toPrometheus());
  });

  // Spreadsheet downloads (.xlsx) for the same data the GraphQL API serves.
  app.use(
    '/export',
    cors(corsOptions),
    createExportRouter({ store, finance: financeService, logger })
  );

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
      contextValue: () => ({ store, finance: financeService, logger, metrics, pubsub }),
    })
  );

  app.use(
    '/graphql',
    cors(corsOptions),
    express.json(),
    expressMiddleware(apolloServer, {
      // Every request shares the same in-memory store.
      context: async () => ({ store, finance: financeService, logger, metrics, pubsub }),
    })
  );

  await new Promise((resolve) => app.listen(PORT, resolve));
  logger.info('graphql endpoint ready', { url: `http://localhost:${PORT}/graphql` });
  logger.info('graphql stream endpoint ready', { url: `http://localhost:${PORT}/graphql/stream` });
}

main().catch((error) => {
  logger.error('failed to start server', { error: error?.message ?? String(error) });
  process.exitCode = 1;
});
