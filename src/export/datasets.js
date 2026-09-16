/**
 * Exportable datasets.
 *
 * Every dataset describes the sheets of a workbook plus a loader that pulls the
 * rows from the same store/finance service the GraphQL resolvers use, so an
 * export always matches what the API returns.
 */
import { isGraphQLInt, validateFinanceArgs } from '../validation/financeArgs.js';

/** Parses the shared pagination/filter query parameters of an export request. */
function readParams(params = {}, { datasetName = 'export', validate = false, requireTaxYear = false } = {}) {
  const issues = [];
  const addIssue = (message) => {
    if (validate) issues.push(message);
  };
  const optionalInt = (name) => {
    if (!Object.hasOwn(params, name) || params[name] === undefined || params[name] === null) return undefined;
    const raw = params[name];
    if (Array.isArray(raw) || raw === '') {
      addIssue(`${name} must be an integer`);
      return undefined;
    }
    const value = String(raw);
    if (!/^-?\d+$/.test(value)) {
      addIssue(`${name} must be an integer`);
      return undefined;
    }
    const parsed = Number(value);
    if (!isGraphQLInt(parsed)) {
      addIssue(`${name} must be a 32-bit integer`);
      return undefined;
    }
    return parsed;
  };
  const optionalString = (name) => {
    if (!Object.hasOwn(params, name) || params[name] === undefined || params[name] === null) return undefined;
    if (Array.isArray(params[name])) {
      addIssue(`${name} must be a string`);
      return undefined;
    }
    return String(params[name]);
  };

  const parsed = {
    accountId: optionalString('accountId'),
    symbol: optionalString('symbol'),
    side: optionalString('side'),
    status: optionalString('status'),
    from: optionalString('from'),
    to: optionalString('to'),
    limit: optionalInt('limit'),
    offset: optionalInt('offset'),
    taxYear: optionalInt('taxYear'),
  };

  if (validate) issues.push(...validateFinanceArgs(parsed, { requireTaxYear }));
  if (issues.length > 0) {
    throw Object.assign(new Error(`invalid query parameters for ${datasetName} export: ${issues.join('; ')}`), { statusCode: 400 });
  }

  return parsed;
}

function countRows(sheets) {
  return sheets.reduce((total, sheet) => total + (sheet.rows?.length ?? 0), 0);
}

function enforceRowLimit(rowCount, maxRows) {
  if (maxRows !== undefined && rowCount > maxRows) {
    throw Object.assign(new Error(`export contains ${rowCount} rows, which exceeds the limit of ${maxRows}`), { statusCode: 413 });
  }
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
      const posts = store.listPosts();
      return {
        sheets: [
          {
            name: 'Posts',
            columns: POST_COLUMNS,
            rows: posts.map((post) => ({
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
    financeArgs: { validate: true },
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
    financeArgs: { validate: true },
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
    financeArgs: { validate: true, requireTaxYear: true },
    async load(params, { finance }) {
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

  const parsedParams = readParams(params, { datasetName: name, ...dataset.financeArgs });
  const result = await dataset.load(parsedParams, context);
  enforceRowLimit(countRows(result.sheets), context.maxExportRows);
  return { filename: dataset.filename, ...result };
}
