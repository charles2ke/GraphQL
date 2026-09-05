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

/** Inclusive date-range check against an ISO timestamp field. */
export function withinRange(timestamp, { from, to } = {}) {
  if (!from && !to) return true;

  const value = new Date(timestamp).getTime();
  if (Number.isNaN(value)) return false;
  const fromValue = from ? new Date(from).getTime() : null;
  const toValue = to ? new Date(to).getTime() : null;
  if ((from && Number.isNaN(fromValue)) || (to && Number.isNaN(toValue))) return false;
  if (fromValue !== null && value < fromValue) return false;
  if (toValue !== null && value > toValue) return false;
  return true;
}

export function filterTrades(trades, { accountId, symbol, side, status, from, to } = {}) {
  return trades.filter((trade) => {
    const accountMatches = accountId ? trade.accountId === accountId : true;
    const symbolMatches = symbol ? trade.symbol === symbol.toUpperCase() : true;
    const sideMatches = side ? trade.side === side.toUpperCase() : true;
    const statusMatches = status ? trade.status === status.toUpperCase() : true;
    return accountMatches && symbolMatches && sideMatches && statusMatches && withinRange(trade.executedAt, { from, to });
  });
}

export function filterOrders(orders, { accountId, symbol, side, status, from, to } = {}) {
  return filterByAccount(orders, accountId).filter((order) => {
    const symbolMatches = symbol ? order.symbol === symbol.toUpperCase() : true;
    const sideMatches = side ? order.side === side.toUpperCase() : true;
    const statusMatches = status ? order.status === status.toUpperCase() : true;
    return symbolMatches && sideMatches && statusMatches && withinRange(order.createdAt, { from, to });
  });
}

export function filterTaxEvents(events, { symbol, from, to } = {}) {
  return events.filter((event) => {
    const symbolMatches = symbol ? event.symbol === symbol.toUpperCase() : true;
    return symbolMatches && withinRange(event.occurredAt, { from, to });
  });
}

export function filterSnapshots(snapshots, { from, to } = {}) {
  return snapshots.filter((snapshot) => withinRange(snapshot.asOf, { from, to }));
}

/**
 * Offset/limit pagination that always reports the total so clients can build
 * page controls without a second round trip.
 */
export function paginate(records, { limit, offset = 0 } = {}, { defaultLimit = 25, maxLimit = 100 } = {}) {
  const totalCount = records.length;
  const safeOffset = Number.isFinite(Number(offset)) ? Math.max(0, Math.trunc(Number(offset))) : 0;
  const requested = limit === undefined || limit === null ? defaultLimit : Number(limit);
  const safeLimit = Math.min(Math.max(0, Number.isFinite(requested) ? Math.trunc(requested) : defaultLimit), maxLimit);
  const items = records.slice(safeOffset, safeOffset + safeLimit);

  return {
    items,
    pageInfo: {
      totalCount,
      limit: safeLimit,
      offset: safeOffset,
      hasNextPage: safeOffset + items.length < totalCount,
      hasPreviousPage: safeOffset > 0,
    },
  };
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
