import { createApp, createSignalHandler } from './app.js';
import { loadServerConfig } from './config/server.js';
import { logger } from './observability/logger.js';

/** Starts the HTTP server and shuts it down gracefully on SIGTERM/SIGINT. */
async function main() {
  const config = loadServerConfig();
  const { httpServer, shutdown } = await createApp({ config });

  await new Promise((resolve, reject) => {
    httpServer.once('error', reject);
    httpServer.listen(config.port, () => {
      httpServer.off('error', reject);
      resolve();
    });
  });
  logger.info('graphql endpoint ready', { url: `http://localhost:${config.port}/graphql` });
  logger.info('graphql stream endpoint ready', { url: `http://localhost:${config.port}/graphql/stream` });

  const onSignal = createSignalHandler({ shutdown, logger, shutdownTimeoutMs: config.shutdownTimeoutMs });
  process.on('SIGTERM', onSignal);
  process.on('SIGINT', onSignal);
}

main().catch((error) => {
  logger.error('failed to start server', { error: error?.message ?? String(error) });
  process.exitCode = 1;
});
