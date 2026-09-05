import { createHttpClient } from '../httpClient.js';

/**
 * Production OpenTrading connector.
 * Exposes exactly the same contract as the mock adapter so the finance service
 * and GraphQL schema are unchanged when switching to a live endpoint.
 */
export function createOpenTradingHttpConnector(config = {}) {
  const client = createHttpClient({ source: 'OpenTrading', ...config });

  return {
    source: 'OpenTrading',
    health: client.health,
    listAccounts: async () => (await client.request('/accounts')).accounts ?? [],
    listTrades: async () => (await client.request('/trades')).trades ?? [],
    listOrders: async () => (await client.request('/orders')).orders ?? [],
  };
}
