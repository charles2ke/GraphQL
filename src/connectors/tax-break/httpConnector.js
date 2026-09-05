import { createHttpClient } from '../httpClient.js';

/** Production tax-break connector mirroring the mock adapter contract. */
export function createTaxBreakHttpConnector(config = {}) {
  const client = createHttpClient({ source: 'tax-break', ...config });

  return {
    source: 'tax-break',
    health: client.health,
    mapTradesToTaxEvents: async (trades) => (await client.request('/tax-events', { method: 'POST', body: { trades } })).events ?? [],
    estimateTax: async ({ events, taxYear }) => client.request('/tax-estimate', { method: 'POST', body: { events, taxYear } }),
  };
}
