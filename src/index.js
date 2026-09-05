import { expressMiddleware } from '@as-integrations/express4';
import cors from 'cors';
import express from 'express';

import { store } from './data/store.js';
import { logger } from './observability/logger.js';
import { metrics } from './observability/metrics.js';
import { financeService } from './services/financeService.js';
import { createApolloServer } from './server.js';

const PORT = Number(process.env.PORT) || 4000;

/** Starts the HTTP server exposing the GraphQL endpoint at /graphql. */
async function main() {
  const apolloServer = createApolloServer({ logger, metrics, enableObservability: true });
  await apolloServer.start();

  const app = express();

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

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer, {
      // Every request shares the same in-memory store.
      context: async () => ({ store, finance: financeService, logger, metrics }),
    })
  );

  await new Promise((resolve) => app.listen(PORT, resolve));
  logger.info('graphql endpoint ready', { url: `http://localhost:${PORT}/graphql` });
}

main().catch((error) => {
  logger.error('failed to start server', { error: error?.message ?? String(error) });
  process.exitCode = 1;
});
