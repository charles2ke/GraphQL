# GraphQL

Make any microservice have a GraphQL implementation.

**Live website: <https://charles2ke.github.io/GraphQL/>**

This repository contains a minimal, working backend service that exposes a GraphQL
API for a small `User` / `Post` domain. It uses in-memory storage, so it runs from a
clean checkout without any database or other external dependency.

## Stack

- [Node.js](https://nodejs.org/) 20+ (ES modules)
- [Apollo Server 5](https://www.apollographql.com/docs/apollo-server/) on [Express 4](https://expressjs.com/) via `@as-integrations/express4`
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
  ci.yml           # Backend tests plus website lint/build on push and PRs
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
- Liveness check: <http://localhost:4000/health>
- Readiness check (per-upstream): <http://localhost:4000/ready>
- Metrics (Prometheus text): <http://localhost:4000/metrics>

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

## Continuous integration

The [`CI`](.github/workflows/ci.yml) workflow runs on every push to `main`, on
every pull request, and on demand from the Actions tab. It has two jobs:

- **Backend tests** — `npm ci` then `npm test` (node:test) at the repository root.
- **Website lint and build** — `npm ci`, `npm run lint` (Oxlint) and
  `GITHUB_PAGES=true npm run build` inside `website/`, matching what the Pages
  deployment builds.

Runs are grouped per branch and superseded runs are cancelled automatically.

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
| `FINANCE_CACHE_TTL_MS` | Resolver cache TTL | `1000` |
| `FINANCE_CACHE_STORE` | Cache strategy: `memory` or `file` (persistent) | `memory` |
| `FINANCE_CACHE_FILE` | Cache file used when `FINANCE_CACHE_STORE=file` | `.cache/finance-cache.json` |
| `FINANCE_CACHE_SHARED_MODULE` | Optional shared cache provider module path used when `FINANCE_CACHE_STORE=shared` | empty |
| `FINANCE_HTTP_TIMEOUT_MS` | Per-request upstream timeout | `5000` |
| `FINANCE_HTTP_MAX_RETRIES` | Retries for timeouts, 429s, and 5xx responses | `2` |
| `FINANCE_DEFAULT_PAGE_SIZE` | Default page size when `limit` is omitted | `25` |
| `FINANCE_MAX_PAGE_SIZE` | Upper bound applied to any requested `limit` | `100` |
| `LOG_LEVEL` | Structured log level (`debug`/`info`/`warn`/`error`) | `info` |

Each connector endpoint that is **not** a `mock://` URL is served by the
production HTTP client in `src/connectors/httpClient.js`, which adds bearer
authentication, request timeouts, bounded retries with exponential backoff, and
per-call metrics. Mock adapters remain the default so the service still runs
from a clean checkout. Live endpoints require the corresponding `*_API_KEY`;
when credentials are missing, connectors fail safely with a non-sensitive auth
error and readiness reports `degraded`.

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
6. Upstream reads go through a short-lived TTL cache
   (`FINANCE_CACHE_TTL_MS`) that also de-duplicates concurrent requests, so
   overlapping resolvers share a single connector call.

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

### Filtering and pagination

Finance queries accept optional filters and offset pagination:

- `portfolioOverview(accountId, from, to, limit, offset)` — `from`/`to` bound
  performance snapshots (inclusive ISO-8601); `limit`/`offset` page positions.
- `tradeHistory(accountId, symbol, side, status, from, to, limit, offset)` —
  filters trades and orders, then pages them. Returned tax events always match
  the trades on the current page.
- `taxEstimate(taxYear, accountId, symbol, from, to, limit, offset)` — totals are
  always computed over every matching event; `limit`/`offset` only page the
  returned `events`.

Every finance payload includes `pageInfo { totalCount limit offset hasNextPage
hasPreviousPage }`. Requested limits are clamped to `FINANCE_MAX_PAGE_SIZE`.
Invalid date ranges (`from > to`) and malformed date/pagination inputs are
rejected with `BAD_USER_INPUT` and `extensions.category = "validation"`.

```graphql
query RecentSells {
  tradeHistory(side: "SELL", from: "2026-01-01T00:00:00.000Z", limit: 10) {
    trades { id symbol quantity price executedAt }
    pageInfo { totalCount hasNextPage }
  }
}
```

### Observability

- **Structured logs**: JSON lines from `src/observability/logger.js`, with
  credential-like fields redacted. One line per GraphQL operation includes the
  operation name, duration, outcome, and error codes.
- **Metrics**: `src/observability/metrics.js` records GraphQL operation
  counts/latency, connector call counts/latency per source and operation,
  upstream retry failures, classified failures
  (`finance_upstream_errors_total{source,operation,category,retryable}`), and
  cache hit/miss/coalesced counters labelled with the active store. Scrape them
  at `GET /metrics`.
- **Error classification**: `src/observability/errors.js` maps every upstream
  failure to a stable `category` (`AUTH`, `RATE_LIMIT`, `TIMEOUT`, `NETWORK`,
  `UPSTREAM_CLIENT_ERROR`, `UPSTREAM_SERVER_ERROR`, `UNKNOWN`) plus `status` and
  `retryable`. Those fields are returned on every payload's
  `errors { source code category status retryable message }`, so a partial
  response still explains what failed and whether retrying helps.
- **API-safe taxonomy**: finance resolver input and internal failures are
  normalized to GraphQL-safe categories: `validation`, `auth`, `upstream`, and
  `internal`, with non-sensitive messages.
- **Health**: `GET /health` is a liveness probe; `GET /ready` calls each
  connector's health check and returns `503` when any upstream is degraded.

### Caching

Upstream reads go through a TTL cache selected by `FINANCE_CACHE_STORE`
(`src/cache/index.js`):

- `memory` (default): in-process, fastest, cleared on restart.
- `file`: the same TTL semantics mirrored to `FINANCE_CACHE_FILE`, so a
  restarted process serves warm upstream data instead of refetching everything.
- `shared`: optional provider loaded from `FINANCE_CACHE_SHARED_MODULE`. The
  module must export `createSharedCacheStore()` returning a store with
  `get(key)`, `set(key, value, ttlMs)`, and `clear()` methods (Redis-like
  adapters can implement this contract). If loading fails, the service logs a
  warning and falls back to `memory`.

Concurrent resolvers asking for the same key share one in-flight request, and
payloads containing upstream errors are never cached so a transient outage is
not pinned for the whole TTL.

Follow-up production tasks:

- Move from offset pagination to cursor pagination if upstream APIs expose
  stable cursors.

## API

| Operation | Description |
| --- | --- |
| `users` | List all users |
| `user(id: ID!)` | Fetch a single user, `null` when unknown |
| `posts` | List all posts |
| `post(id: ID!)` | Fetch a single post, `null` when unknown |
| `portfolioOverview(accountId, from, to, limit, offset)` | Fetch finance accounts, positions, snapshots, and P/L |
| `tradeHistory(accountId, symbol, side, status, from, to, limit, offset)` | Fetch trades/orders enriched with tax events |
| `taxEstimate(taxYear, accountId, symbol, from, to, limit, offset)` | Estimate tax from tax-relevant trading activity |
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
