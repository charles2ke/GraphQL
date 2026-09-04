/** Mock OpenTrading connector. Replace this contract with HTTP/gRPC calls later. */
export function createOpenTradingConnector(_config = {}) {
  const accounts = [
    { acct_id: 'acct-1', display_name: 'Primary Brokerage', account_type: 'BROKERAGE', base_currency: 'USD', source: 'OpenTrading' },
  ];

  const trades = [
    {
      trade_id: 'trade-1',
      acct_id: 'acct-1',
      order_ref: 'order-1',
      ticker: 'AAPL',
      action: 'BUY',
      qty: 10,
      avg_px: 150,
      trade_time: '2026-01-10T14:31:00.000Z',
      status: 'FILLED',
      fills: [{ fill_id: 'fill-1', fill_qty: 10, fill_px: 150, filled_at: '2026-01-10T14:31:00.000Z' }],
    },
    {
      trade_id: 'trade-2',
      acct_id: 'acct-1',
      order_ref: 'order-2',
      ticker: 'AAPL',
      action: 'SELL',
      qty: 4,
      avg_px: 180,
      trade_time: '2026-04-05T15:45:00.000Z',
      status: 'FILLED',
      fills: [{ fill_id: 'fill-2', fill_qty: 4, fill_px: 180, filled_at: '2026-04-05T15:45:00.000Z' }],
    },
  ];

  const orders = [
    { order_id: 'order-1', acct_id: 'acct-1', ticker: 'AAPL', action: 'BUY', qty: 10, limit_price: 150, status: 'FILLED', created_at: '2026-01-10T14:30:00.000Z', fills: trades[0].fills },
    { order_id: 'order-2', acct_id: 'acct-1', ticker: 'AAPL', action: 'SELL', qty: 4, limit_price: 180, status: 'FILLED', created_at: '2026-04-05T15:40:00.000Z', fills: trades[1].fills },
  ];

  return {
    source: 'OpenTrading',
    health: async () => ({ source: 'OpenTrading', status: 'ok', endpoint: 'mock://opentrading' }),
    listAccounts: async () => accounts,
    listTrades: async () => trades,
    listOrders: async () => orders,
  };
}
