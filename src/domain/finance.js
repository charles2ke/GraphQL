const money = (value) => Number(Number(value ?? 0).toFixed(2));

export function normalizeAccount(account) {
  return {
    id: String(account.id ?? account.account_id ?? account.acct_id),
    name: account.name ?? account.display_name ?? 'Brokerage Account',
    type: account.type ?? account.account_type ?? 'BROKERAGE',
    currency: account.currency ?? account.base_currency ?? 'USD',
    provider: account.provider ?? account.source ?? 'unknown',
  };
}

export function normalizePosition(position) {
  const quantity = Number(position.quantity ?? position.qty ?? position.shares ?? 0);
  const averageCost = Number(position.averageCost ?? position.avg_cost ?? position.cost_basis_per_share ?? 0);
  const marketPrice = Number(position.marketPrice ?? position.last_price ?? position.market_price ?? 0);
  const marketValue = money(position.marketValue ?? position.market_value ?? quantity * marketPrice);
  const costBasis = money(quantity * averageCost);

  return {
    id: String(position.id ?? `${position.accountId ?? position.account_id ?? position.acct_id}:${position.symbol ?? position.ticker}`),
    accountId: String(position.accountId ?? position.account_id ?? position.acct_id),
    symbol: String(position.symbol ?? position.ticker).toUpperCase(),
    quantity,
    averageCost,
    marketPrice,
    marketValue,
    unrealizedPnL: money(position.unrealizedPnL ?? position.unrealized_pnl ?? marketValue - costBasis),
  };
}

export function normalizeFill(fill) {
  return {
    id: String(fill.id ?? fill.fill_id),
    quantity: Number(fill.quantity ?? fill.fill_qty ?? 0),
    price: Number(fill.price ?? fill.fill_px ?? 0),
    executedAt: fill.executedAt ?? fill.filled_at,
  };
}

export function normalizeTrade(trade) {
  return {
    id: String(trade.id ?? trade.trade_id),
    accountId: String(trade.accountId ?? trade.account_id ?? trade.acct_id),
    orderId: String(trade.orderId ?? trade.order_ref ?? trade.order_id),
    symbol: String(trade.symbol ?? trade.ticker).toUpperCase(),
    side: String(trade.side ?? trade.action).toUpperCase(),
    quantity: Number(trade.quantity ?? trade.qty ?? 0),
    price: Number(trade.price ?? trade.avg_px ?? 0),
    status: trade.status ?? 'FILLED',
    executedAt: trade.executedAt ?? trade.trade_time,
    fills: (trade.fills ?? []).map(normalizeFill),
  };
}

export function normalizeOrder(order) {
  return {
    id: String(order.id ?? order.order_id),
    accountId: String(order.accountId ?? order.account_id ?? order.acct_id),
    symbol: String(order.symbol ?? order.ticker).toUpperCase(),
    side: String(order.side ?? order.action).toUpperCase(),
    quantity: Number(order.quantity ?? order.qty ?? 0),
    limitPrice: order.limitPrice ?? order.limit_price ?? null,
    status: order.status ?? 'UNKNOWN',
    createdAt: order.createdAt ?? order.created_at,
    fills: (order.fills ?? []).map(normalizeFill),
  };
}

export function normalizePerformanceSnapshot(snapshot) {
  return {
    id: String(snapshot.id ?? `${snapshot.accountId ?? snapshot.account_id}:${snapshot.asOf ?? snapshot.as_of}`),
    accountId: String(snapshot.accountId ?? snapshot.account_id),
    asOf: snapshot.asOf ?? snapshot.as_of,
    totalValue: money(snapshot.totalValue ?? snapshot.total_value ?? 0),
    cash: money(snapshot.cash ?? snapshot.cash_balance ?? 0),
    marketValue: money(snapshot.marketValue ?? snapshot.market_value ?? 0),
    dayPnL: money(snapshot.dayPnL ?? snapshot.day_pnl ?? 0),
    totalPnL: money(snapshot.totalPnL ?? snapshot.total_pnl ?? 0),
  };
}

export function tradeToTaxEvent(trade) {
  const proceeds = trade.side === 'SELL' ? money(trade.quantity * trade.price) : 0;
  const costBasis = trade.side === 'SELL' ? money(trade.quantity * trade.price * 0.82) : money(trade.quantity * trade.price);

  return {
    id: `tax-${trade.id}`,
    tradeId: trade.id,
    symbol: trade.symbol,
    quantity: trade.quantity,
    proceeds,
    costBasis,
    realizedGain: money(proceeds - costBasis),
    holdingPeriod: 'SHORT_TERM',
    occurredAt: trade.executedAt,
  };
}

export function aggregatePortfolio({ accounts = [], positions = [], snapshots = [], errors = [] }) {
  return {
    accounts,
    positions,
    performance: snapshots,
    currency: accounts[0]?.currency ?? 'USD',
    totalMarketValue: money(positions.reduce((sum, position) => sum + position.marketValue, 0)),
    totalUnrealizedPnL: money(positions.reduce((sum, position) => sum + position.unrealizedPnL, 0)),
    errors,
  };
}

export function filterByAccount(records, accountId) {
  return accountId ? records.filter((record) => record.accountId === accountId || record.id === accountId) : records;
}

export function filterTrades(trades, { accountId, symbol } = {}) {
  return trades.filter((trade) => {
    const accountMatches = accountId ? trade.accountId === accountId : true;
    const symbolMatches = symbol ? trade.symbol === symbol.toUpperCase() : true;
    return accountMatches && symbolMatches;
  });
}

export function estimateTaxFromEvents(events, taxYear, rate = 0.22) {
  const taxableEvents = events.filter((event) => new Date(event.occurredAt).getUTCFullYear() === taxYear);
  const totalProceeds = money(taxableEvents.reduce((sum, event) => sum + event.proceeds, 0));
  const totalCostBasis = money(taxableEvents.reduce((sum, event) => sum + event.costBasis, 0));
  const realizedGain = money(taxableEvents.reduce((sum, event) => sum + event.realizedGain, 0));

  return {
    taxYear,
    currency: 'USD',
    totalProceeds,
    totalCostBasis,
    realizedGain,
    estimatedTax: money(Math.max(realizedGain, 0) * rate),
    taxRate: rate,
    events: taxableEvents,
    errors: [],
  };
}
