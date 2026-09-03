import { estimateTaxFromEvents, tradeToTaxEvent } from '../../domain/finance.js';

/** Mock tax-break connector for tax-event enrichment and estimate calculations. */
export function createTaxBreakConnector(_config = {}) {
  return {
    source: 'tax-break',
    mapTradesToTaxEvents: async (trades) => trades.filter((trade) => trade.side === 'SELL').map(tradeToTaxEvent),
    estimateTax: async ({ events, taxYear }) => estimateTaxFromEvents(events, taxYear, 0.22),
  };
}
