/**
 * Exportable datasets.
 *
 * Every dataset describes the sheets of a workbook plus a loader that pulls the
 * rows from the same store/finance service the GraphQL resolvers use, so an
 * export always matches what the API returns.
 */

/** Parses the shared pagination/filter query parameters of an export request. */
function readParams(params = {}) {
  const optionalInt = (value) => {
    if (value === undefined || value === null || value === '') return undefined;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? undefined : parsed;
  };
  const optionalString = (value) => (typeof value === 'string' && value !== '' ? value : undefined);

  return {
    accountId: optionalString(params.accountId),
    symbol: optionalString(params.symbol),
    side: optionalString(params.side),
    status: optionalString(params.status),
    from: optionalString(params.from),
    to: optionalString(params.to),
    limit: optionalInt(params.limit),
    offset: optionalInt(params.offset),
    taxYear: optionalInt(params.taxYear),
  };
}

const USER_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'name', header: 'Name' },
  { key: 'email', header: 'Email' },
  { key: 'postCount', header: 'Posts' },
];

const POST_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'title', header: 'Title' },
  { key: 'content', header: 'Content' },
  { key: 'authorId', header: 'Author Id' },
  { key: 'authorName', header: 'Author' },
];

const ACCOUNT_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'name', header: 'Name' },
  { key: 'type', header: 'Type' },
  { key: 'currency', header: 'Currency' },
  { key: 'provider', header: 'Provider' },
];

const POSITION_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'accountId', header: 'Account Id' },
  { key: 'symbol', header: 'Symbol' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'averageCost', header: 'Average Cost' },
  { key: 'marketPrice', header: 'Market Price' },
  { key: 'marketValue', header: 'Market Value' },
  { key: 'unrealizedPnL', header: 'Unrealized P/L' },
];

const PERFORMANCE_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'accountId', header: 'Account Id' },
  { key: 'asOf', header: 'As Of' },
  { key: 'totalValue', header: 'Total Value' },
  { key: 'cash', header: 'Cash' },
  { key: 'marketValue', header: 'Market Value' },
  { key: 'dayPnL', header: 'Day P/L' },
  { key: 'totalPnL', header: 'Total P/L' },
];

const TRADE_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'accountId', header: 'Account Id' },
  { key: 'orderId', header: 'Order Id' },
  { key: 'symbol', header: 'Symbol' },
  { key: 'side', header: 'Side' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'price', header: 'Price' },
  { key: 'status', header: 'Status' },
  { key: 'executedAt', header: 'Executed At' },
];

const ORDER_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'accountId', header: 'Account Id' },
  { key: 'symbol', header: 'Symbol' },
  { key: 'side', header: 'Side' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'limitPrice', header: 'Limit Price' },
  { key: 'status', header: 'Status' },
  { key: 'createdAt', header: 'Created At' },
];

const TAX_EVENT_COLUMNS = [
  { key: 'id', header: 'Id' },
  { key: 'tradeId', header: 'Trade Id' },
  { key: 'symbol', header: 'Symbol' },
  { key: 'quantity', header: 'Quantity' },
  { key: 'proceeds', header: 'Proceeds' },
  { key: 'costBasis', header: 'Cost Basis' },
  { key: 'realizedGain', header: 'Realized Gain' },
  { key: 'holdingPeriod', header: 'Holding Period' },
  { key: 'occurredAt', header: 'Occurred At' },
];

/** Registry of everything the /export endpoint can produce. */
export const datasets = {
  users: {
    filename: 'users',
    async load(_params, { store }) {
      const users = store.listUsers();
      return {
        sheets: [
          {
            name: 'Users',
            columns: USER_COLUMNS,
            rows: users.map((user) => ({ ...user, postCount: store.listPostsByAuthor(user.id).length })),
          },
        ],
      };
    },
  },

  posts: {
    filename: 'posts',
    async load(_params, { store }) {
      return {
        sheets: [
          {
            name: 'Posts',
            columns: POST_COLUMNS,
            rows: store.listPosts().map((post) => ({
              ...post,
              authorName: store.getUser(post.authorId)?.name ?? '',
            })),
          },
        ],
      };
    },
  },

  portfolio: {
    filename: 'portfolio-overview',
    async load(params, { finance }) {
      const overview = await finance.portfolioOverview(params);
      return {
        sheets: [
          { name: 'Accounts', columns: ACCOUNT_COLUMNS, rows: overview.accounts },
          { name: 'Positions', columns: POSITION_COLUMNS, rows: overview.positions },
          { name: 'Performance', columns: PERFORMANCE_COLUMNS, rows: overview.performance },
        ],
        errors: overview.errors,
      };
    },
  },

  trades: {
    filename: 'trade-history',
    async load(params, { finance }) {
      const history = await finance.tradeHistory(params);
      return {
        sheets: [
          { name: 'Trades', columns: TRADE_COLUMNS, rows: history.trades },
          { name: 'Orders', columns: ORDER_COLUMNS, rows: history.orders },
          { name: 'Tax Events', columns: TAX_EVENT_COLUMNS, rows: history.taxEvents },
        ],
        errors: history.errors,
      };
    },
  },

  'tax-estimate': {
    filename: 'tax-estimate',
    async load(params, { finance }) {
      if (params.taxYear === undefined) {
        throw Object.assign(new Error('taxYear query parameter is required'), { statusCode: 400 });
      }

      const summary = await finance.taxEstimate(params);
      return {
        sheets: [
          {
            name: 'Summary',
            columns: [
              { key: 'taxYear', header: 'Tax Year' },
              { key: 'currency', header: 'Currency' },
              { key: 'totalProceeds', header: 'Total Proceeds' },
              { key: 'totalCostBasis', header: 'Total Cost Basis' },
              { key: 'realizedGain', header: 'Realized Gain' },
              { key: 'estimatedTax', header: 'Estimated Tax' },
              { key: 'taxRate', header: 'Tax Rate' },
            ],
            rows: [summary],
          },
          { name: 'Tax Events', columns: TAX_EVENT_COLUMNS, rows: summary.events },
        ],
        errors: summary.errors,
      };
    },
  },
};

/** Dataset names accepted by the export endpoint. */
export const datasetNames = Object.keys(datasets);

/**
 * Loads a dataset into workbook sheets.
 *
 * @throws {Error & {statusCode: number}} when the dataset is unknown or params are invalid
 */
export async function loadDataset(name, params, context) {
  const dataset = datasets[name];
  if (!dataset) {
    throw Object.assign(new Error(`unknown dataset "${name}"`), { statusCode: 404, datasets: datasetNames });
  }

  const result = await dataset.load(readParams(params), context);
  return { filename: dataset.filename, ...result };
}
