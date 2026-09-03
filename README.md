# GraphQL

Make any microservice have a GraphQL implementation.

**Live website: <https://charles2ke.github.io/GraphQL/>**

This repository contains a minimal, working backend service that exposes a GraphQL
API for a small `User` / `Post` domain. It uses in-memory storage, so it runs from a
clean checkout without any database or other external dependency.

## Stack

- [Node.js](https://nodejs.org/) 18+ (ES modules)
- [Apollo Server 4](https://www.apollographql.com/docs/apollo-server/) on [Express](https://expressjs.com/)
- [graphql-js](https://github.com/graphql/graphql-js)
- Tests with the built-in `node:test` runner

## Project structure

```
src/
  index.js         # HTTP bootstrap: Express app + /graphql endpoint
  server.js        # Apollo Server factory (reused by the tests)
  schema.js        # GraphQL type definitions
  resolvers.js     # Query / Mutation / field resolvers
  config/finance.js # Environment-driven finance connector config
  connectors/      # Replaceable OpenTrading, Portfolio-Watcher, tax-break adapters
  data/store.js    # In-memory data store with seed data
  domain/finance.js # Canonical finance models and normalization helpers
  services/financeService.js # Finance aggregation, caching, and error handling
test/
  graphql.test.js  # API tests executed against the schema
website/
  src/App.jsx      # Learning site: primer, tips, API Explorer
  src/backendSamples.js  # GraphQL server samples in 10 backend languages
  vite.config.js   # Vite config (GitHub Pages base path + /graphql dev proxy)
.github/workflows/
  deploy-pages.yml # Builds website/ and publishes it to GitHub Pages
```

## Installation

```bash
git clone https://github.com/charles2ke/GraphQL.git
cd GraphQL
npm install
```

## Running locally

```bash
npm start          # or: npm run dev  (restarts on file changes)
```

The server listens on port `4000` by default (override with the `PORT`
environment variable):

- GraphQL endpoint: <http://localhost:4000/graphql>
- Health check: <http://localhost:4000/health>

Opening the GraphQL endpoint in a browser loads the Apollo Sandbox, where you can
explore the schema and run the operations below.

## Learning website

The React learning website includes a GraphQL primer, side-by-side server samples
for ten backend languages, practical tips, and an interactive API Explorer that
runs requests against this service.

The site is published with GitHub Pages at
<https://charles2ke.github.io/GraphQL/>. Every push to `main` is deployed by the
[`Deploy website to GitHub Pages`](.github/workflows/deploy-pages.yml) workflow;
the workflow can also be run manually from the Actions tab. The workflow enables
Pages and forces its build type to GitHub Actions, so the built website — not the
Jekyll-rendered README — is what gets served. If the deployment ever fails to
update the Pages configuration, set **Settings → Pages → Source** to
**GitHub Actions** once and re-run the workflow.

```bash
cd website
npm install
npm run dev
```

Keep the API server running on port `4000`, then open the URL printed by Vite
(normally <http://localhost:5173>). The API Explorer is available at
`/#explorer`. During development, Vite proxies `/graphql` requests to the local
API. To target a different API, start Vite with `VITE_GRAPHQL_URL` set to its
GraphQL endpoint.

To build the same static site that GitHub Pages deploys:

```bash
cd website
GITHUB_PAGES=true npm run build   # output in website/dist
npm run preview                   # serve the production build locally
npm run lint                      # Oxlint
```

## Tests

```bash
npm test
```

## Finance Cluster Integration (Priority 1)

This service now exposes a unified finance GraphQL surface over three upstream
domains:

- **OpenTrading**: accounts, orders, trades, and fills
- **Portfolio-Watcher**: holdings/positions and performance snapshots
- **tax-break**: trade-to-tax-event mapping and tax estimate summaries

The initial implementation uses mock connectors under `src/connectors/` so the
API runs from a clean checkout. Each connector exposes a small async contract
that can be replaced later with HTTP, gRPC, queue, or database-backed clients
without changing the GraphQL schema.

### Configuration

The running server loads connector settings from the environment via
`src/config/finance.js`:

| Variable | Description | Default |
| --- | --- | --- |
| `OPENTRADING_ENDPOINT` | OpenTrading endpoint placeholder | `mock://opentrading` |
| `OPENTRADING_API_KEY` | OpenTrading credential placeholder | empty |
| `PORTFOLIO_WATCHER_ENDPOINT` | Portfolio-Watcher endpoint placeholder | `mock://portfolio-watcher` |
| `PORTFOLIO_WATCHER_API_KEY` | Portfolio-Watcher credential placeholder | empty |
| `TAX_BREAK_ENDPOINT` | tax-break endpoint placeholder | `mock://tax-break` |
| `TAX_BREAK_API_KEY` | tax-break credential placeholder | empty |
| `FINANCE_CACHE_TTL_MS` | Minimal resolver cache TTL | `1000` |

Do not commit real credentials. Production connectors should read credentials
from environment variables or a secret manager and keep the same method names as
the mock adapters.

### Data flow

1. GraphQL resolvers call `financeService` through the request context.
2. `financeService` calls each upstream connector and normalizes inconsistent
   field names in `src/domain/finance.js`.
3. OpenTrading trades are enriched through tax-break into `TaxEvent` records.
4. Portfolio-Watcher positions and snapshots are aggregated with accounts into a
   portfolio overview with total market value and unrealized P/L.
5. Connector failures are captured as `FinanceUpstreamError` objects so clients
   receive actionable source/code/message details while still getting any
   partial data from healthy upstreams.

### Finance queries

Portfolio overview with positions and P/L:

```graphql
query PortfolioOverview {
  portfolioOverview {
    accounts { id name provider currency }
    positions { symbol quantity marketValue unrealizedPnL }
    performance { asOf totalValue dayPnL totalPnL }
    totalMarketValue
    totalUnrealizedPnL
    errors { source code message }
  }
}
```

Trade history mapped to tax-relevant events:

```graphql
query TradeHistory {
  tradeHistory(symbol: "AAPL") {
    trades { id side symbol quantity price executedAt }
    taxEvents { tradeId proceeds costBasis realizedGain occurredAt }
    errors { source code message }
  }
}
```

Tax summary traceable to the underlying trading activity:

```graphql
query TaxEstimate {
  taxEstimate(taxYear: 2026) {
    totalProceeds
    totalCostBasis
    realizedGain
    estimatedTax
    events { id tradeId realizedGain }
    errors { source code message }
  }
}
```

Run the API and tests with the existing commands:

```bash
npm start
npm test
```

Follow-up production tasks:

- Replace mock connectors with authenticated clients for each upstream domain.
- Add pagination/date filters once live trade and snapshot volumes grow.
- Add persisted caching/batching if upstream latency becomes significant.

## API

| Operation | Description |
| --- | --- |
| `users` | List all users |
| `user(id: ID!)` | Fetch a single user, `null` when unknown |
| `posts` | List all posts |
| `post(id: ID!)` | Fetch a single post, `null` when unknown |
| `portfolioOverview(accountId)` | Fetch finance accounts, positions, snapshots, and P/L |
| `tradeHistory(accountId, symbol)` | Fetch trades/orders enriched with tax events |
| `taxEstimate(taxYear, accountId)` | Estimate tax from tax-relevant trading activity |
| `createUser(name, email)` | Create a user |
| `createPost(title, content, authorId)` | Create a post for an existing user |

### Example queries

List users with their posts:

```graphql
query Users {
  users {
    id
    name
    email
    posts {
      id
      title
    }
  }
}
```

Fetch one user:

```graphql
query User {
  user(id: "1") {
    name
    email
  }
}
```

List posts with their author:

```graphql
query Posts {
  posts {
    id
    title
    content
    author {
      id
      name
    }
  }
}
```

### Example mutations

```graphql
mutation CreateUser {
  createUser(name: "Grace Hopper", email: "grace@example.com") {
    id
    name
  }
}
```

```graphql
mutation CreatePost {
  createPost(title: "Nanoseconds", content: "A talk about wire lengths.", authorId: "1") {
    id
    title
    author {
      name
    }
  }
}
```

Creating a post for an unknown `authorId` returns a `BAD_USER_INPUT` error.

### With curl

```bash
curl http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"{ users { id name posts { title } } }"}'
```

## Notes

Data lives in memory only, so every restart resets the service to its seed data
(two users and two posts). Swapping `src/data/store.js` for a database-backed
implementation is enough to persist data — the resolvers receive the store through
the GraphQL context.
