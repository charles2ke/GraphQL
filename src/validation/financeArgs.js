const GRAPHQL_INT_MIN = -2147483648;
const GRAPHQL_INT_MAX = 2147483647;

export function isGraphQLInt(value) {
  return Number.isInteger(value) && value >= GRAPHQL_INT_MIN && value <= GRAPHQL_INT_MAX;
}

export function isIsoDate(value) {
  const match = typeof value === 'string' && value.match(/^(\d{4}-\d{2}-\d{2})(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/);
  if (!match) return false;
  const calendarDate = new Date(`${match[1]}T00:00:00.000Z`);
  return Number.isFinite(calendarDate.getTime()) && calendarDate.toISOString().startsWith(match[1]) && Number.isFinite(new Date(value).getTime());
}

export function validateFinanceArgs(args, { requireTaxYear = false } = {}) {
  const issues = [];
  if (args.from !== undefined && args.from !== null && !isIsoDate(args.from)) issues.push('from must be a valid ISO-8601 date');
  if (args.to !== undefined && args.to !== null && !isIsoDate(args.to)) issues.push('to must be a valid ISO-8601 date');
  if (isIsoDate(args.from) && isIsoDate(args.to) && new Date(args.from).getTime() > new Date(args.to).getTime()) {
    issues.push('from must be earlier than or equal to to');
  }
  if (args.limit !== undefined && args.limit !== null && (!isGraphQLInt(args.limit) || args.limit < 0)) {
    issues.push('limit must be a non-negative integer');
  }
  if (args.offset !== undefined && args.offset !== null && (!isGraphQLInt(args.offset) || args.offset < 0)) {
    issues.push('offset must be a non-negative integer');
  }
  if (requireTaxYear && (args.taxYear === undefined || args.taxYear === null)) {
    issues.push('taxYear query parameter is required');
  } else if (requireTaxYear && (!isGraphQLInt(args.taxYear) || args.taxYear < 1900 || args.taxYear > 9999)) {
    issues.push('taxYear must be between 1900 and 9999');
  }
  return issues;
}
