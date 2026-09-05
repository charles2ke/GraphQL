/** GraphQL schema definition for the demo service. */
export const typeDefs = /* GraphQL */ `
  "A person who can author posts."
  type User {
    id: ID!
    name: String!
    email: String!
    "Posts written by this user."
    posts: [Post!]!
  }

  "A piece of content written by a user."
  type Post {
    id: ID!
    title: String!
    content: String!
    "The user who wrote the post."
    author: User!
  }

  "A normalized brokerage or tax account from the finance cluster."
  type Account {
    id: ID!
    name: String!
    type: String!
    currency: String!
    provider: String!
  }

  "A normalized holding/position with market value and unrealized P/L."
  type Holding {
    id: ID!
    accountId: ID!
    symbol: String!
    quantity: Float!
    averageCost: Float!
    marketPrice: Float!
    marketValue: Float!
    unrealizedPnL: Float!
  }

  "A single execution fill for an order or trade."
  type Fill {
    id: ID!
    quantity: Float!
    price: Float!
    executedAt: String!
  }

  "A normalized OpenTrading order."
  type Order {
    id: ID!
    accountId: ID!
    symbol: String!
    side: String!
    quantity: Float!
    limitPrice: Float
    status: String!
    createdAt: String!
    fills: [Fill!]!
  }

  "A normalized OpenTrading trade."
  type Trade {
    id: ID!
    accountId: ID!
    orderId: ID!
    symbol: String!
    side: String!
    quantity: Float!
    price: Float!
    status: String!
    executedAt: String!
    fills: [Fill!]!
  }

  "A Portfolio-Watcher valuation snapshot."
  type PerformanceSnapshot {
    id: ID!
    accountId: ID!
    asOf: String!
    totalValue: Float!
    cash: Float!
    marketValue: Float!
    dayPnL: Float!
    totalPnL: Float!
  }

  "A tax-relevant event derived from trading activity."
  type TaxEvent {
    id: ID!
    tradeId: ID!
    symbol: String!
    quantity: Float!
    proceeds: Float!
    costBasis: Float!
    realizedGain: Float!
    holdingPeriod: String!
    occurredAt: String!
  }

  "Actionable upstream error details returned with partial finance data."
  type FinanceUpstreamError {
    source: String!
    code: String!
    message: String!
  }

  "Offset-based pagination metadata for finance collections."
  type PageInfo {
    totalCount: Int!
    limit: Int!
    offset: Int!
    hasNextPage: Boolean!
    hasPreviousPage: Boolean!
  }

  "Cross-source portfolio overview composed from OpenTrading and Portfolio-Watcher."
  type PortfolioOverview {
    accounts: [Account!]!
    positions: [Holding!]!
    performance: [PerformanceSnapshot!]!
    currency: String!
    totalMarketValue: Float!
    totalUnrealizedPnL: Float!
    "Pagination metadata for the returned positions."
    pageInfo: PageInfo!
    errors: [FinanceUpstreamError!]!
  }

  "Trade/order history enriched with tax-relevant events."
  type TradeHistory {
    trades: [Trade!]!
    orders: [Order!]!
    taxEvents: [TaxEvent!]!
    "Pagination metadata for the returned trades."
    pageInfo: PageInfo!
    errors: [FinanceUpstreamError!]!
  }

  "Tax estimate summary traceable to underlying tax events."
  type TaxEstimateSummary {
    taxYear: Int!
    currency: String!
    totalProceeds: Float!
    totalCostBasis: Float!
    realizedGain: Float!
    estimatedTax: Float!
    taxRate: Float!
    events: [TaxEvent!]!
    "Pagination metadata for the returned tax events."
    pageInfo: PageInfo!
    errors: [FinanceUpstreamError!]!
  }

  type Query {
    "All users."
    users: [User!]!
    "A single user by id, or null when not found."
    user(id: ID!): User
    "All posts."
    posts: [Post!]!
    "A single post by id, or null when not found."
    post(id: ID!): Post
    """
    Unified finance overview with accounts, positions, snapshots, and P/L.
    Date bounds (from/to, inclusive ISO-8601) apply to performance snapshots;
    limit/offset paginate the returned positions.
    """
    portfolioOverview(accountId: ID, from: String, to: String, limit: Int, offset: Int): PortfolioOverview!
    """
    OpenTrading trades/orders mapped to tax-break tax events.
    Trades and orders can be filtered by account, symbol, side, status, and an
    inclusive ISO-8601 execution date range, then paginated.
    """
    tradeHistory(
      accountId: ID
      symbol: String
      side: String
      status: String
      from: String
      to: String
      limit: Int
      offset: Int
    ): TradeHistory!
    """
    Tax estimate derived from normalized trading activity. Totals always cover
    every matching event; limit/offset only paginate the returned events.
    """
    taxEstimate(
      taxYear: Int!
      accountId: ID
      symbol: String
      from: String
      to: String
      limit: Int
      offset: Int
    ): TaxEstimateSummary!
  }

  type Mutation {
    createUser(name: String!, email: String!): User!
    createPost(title: String!, content: String!, authorId: ID!): Post!
  }
`;
