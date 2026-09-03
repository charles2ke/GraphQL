/** Mock Portfolio-Watcher connector for positions and performance snapshots. */
export function createPortfolioWatcherConnector(_config = {}) {
  const positions = [
    { id: 'pos-1', account_id: 'acct-1', ticker: 'AAPL', shares: 6, avg_cost: 150, last_price: 182.5 },
    { id: 'pos-2', account_id: 'acct-1', ticker: 'MSFT', shares: 3, avg_cost: 320, last_price: 350 },
  ];

  const snapshots = [
    { id: 'snap-1', account_id: 'acct-1', as_of: '2026-04-05T21:00:00.000Z', total_value: 2745, cash_balance: 600, market_value: 2145, day_pnl: 32.5, total_pnl: 285 },
  ];

  return {
    source: 'Portfolio-Watcher',
    listPositions: async () => positions,
    listPerformanceSnapshots: async () => snapshots,
  };
}
