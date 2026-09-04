import { createHttpClient } from '../httpClient.js';

/** Production Portfolio-Watcher connector mirroring the mock adapter contract. */
export function createPortfolioWatcherHttpConnector(config = {}) {
  const client = createHttpClient({ source: 'Portfolio-Watcher', ...config });

  return {
    source: 'Portfolio-Watcher',
    health: client.health,
    listPositions: async () => (await client.request('/positions')).positions ?? [],
    listPerformanceSnapshots: async () => (await client.request('/performance')).snapshots ?? [],
  };
}
