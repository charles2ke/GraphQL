import { expressMiddleware } from '@as-integrations/express4';
import cors from 'cors';
import express from 'express';

import { store } from './data/store.js';
import { financeService } from './services/financeService.js';
import { createApolloServer } from './server.js';

const PORT = Number(process.env.PORT) || 4000;

/** Starts the HTTP server exposing the GraphQL endpoint at /graphql. */
async function main() {
  const apolloServer = createApolloServer();
  await apolloServer.start();

  const app = express();

  // Simple liveness probe, handy when running the service in a container.
  app.get('/health', (_req, res) => res.json({ status: 'ok' }));

  app.use(
    '/graphql',
    cors(),
    express.json(),
    expressMiddleware(apolloServer, {
      // Every request shares the same in-memory store.
      context: async () => ({ store, finance: financeService }),
    })
  );

  await new Promise((resolve) => app.listen(PORT, resolve));
  console.log(`🚀 GraphQL endpoint ready at http://localhost:${PORT}/graphql`);
}

main().catch((error) => {
  console.error('Failed to start server:', error);
  process.exitCode = 1;
});
