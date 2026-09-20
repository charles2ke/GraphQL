# GraphQL

Make any microservice have a GraphQL implementation.

[![CI](https://github.com/charles2ke/GraphQL/actions/workflows/ci.yml/badge.svg)](https://github.com/charles2ke/GraphQL/actions/workflows/ci.yml)
[![Deploy website to GitHub Pages](https://github.com/charles2ke/GraphQL/actions/workflows/deploy-pages.yml/badge.svg)](https://github.com/charles2ke/GraphQL/actions/workflows/deploy-pages.yml)
[![Node.js 20+](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org/)
[![License: Apache-2.0](https://img.shields.io/badge/license-Apache--2.0-blue)](LICENSE)

**Live website: <https://charles2ke.github.io/GraphQL/>**

This repository contains a minimal, working backend service that exposes a GraphQL
API for a small `User` / `Post` domain, plus an optional finance surface that
aggregates three upstream domains. It uses in-memory storage and mock connectors,
so it runs from a clean checkout without any database or other external
dependency.

## Quick start

```bash
git clone https://github.com/charles2ke/GraphQL.git
cd GraphQL
npm install
npm start          # http://localhost:4000/graphql
npm test           # node:test suite
```

Open <http://localhost:4000/graphql> in a browser to explore the schema in the
Apollo Sandbox, or jump to [Example queries](#example-queries).

## Contents

- [Stack](#stack)
- [Project structure](#project-structure)
- [Installation and running locally](#installation-and-running-locally)
- [Learning website](#learning-website)
- [Tests](#tests)
- [Continuous integration](#continuous-integration)
- [API](#api)
- [Streaming](#streaming)
- [CORS](#cors)
- [Excel export](#excel-export)
- [Finance cluster integration](#finance-cluster-integration)
- [Notes](#notes)
- [Security and license](#security-and-license)

## Stack

- [Node.js](https://nodejs.org/) 20+ (ES modules)
- [Apollo Server 5](https://www.apollographql.com/docs/apollo-server/) on [Express 4](https://expressjs.com/) via `@as-integrations/express4`
- [graphql-js](https://github.com/graphql/graphql-js)
- Tests with the built-in `node:test` runner

## Project structure

```
src/
  index.js         # HTTP bootstrap: Express app + /graphql, /export, /graphql/stream
  server.js        # Apollo Server factory (reused by the tests)
  schema.js        # GraphQL type definitions and executable schema factory
  resolvers.js     # Query / Mutation / Subscription / field resolvers
  cache/index.js   # Pluggable TTL cache (memory, file, shared provider)
  config/          # Environment-driven finance and CORS configuration
  connectors/      # OpenTrading, Portfolio-Watcher, tax-break adapters + HTTP client
  data/store.js    # In-memory data store with seed data
  domain/finance.js # Canonical finance models and normalization helpers
  export/          # Excel (.xlsx) writer, dataset registry, and /export routes
  observability/   # Structured logging, metrics, error classification, Apollo plugin
  services/financeService.js # Finance aggregation, caching, and error handling
  streaming/       # In-process pub/sub and the SSE streaming endpoint
  validation/financeArgs.js  # Shared finance argument validation
test/
  graphql.test.js      # API tests executed against the schema
  finance.test.js      # Finance service, filtering, and pagination tests
  connectors.test.js   # Connector selection and HTTP client tests
  cors.test.js         # CORS allow-list tests
  export.test.js       # Excel export writer, dataset, and route tests
  observability.test.js # Logging, metrics, and error classification tests
  resilience.test.js   # Timeout, retry, and partial-failure tests
  streaming.test.js    # Pub/sub and Server-Sent Events streaming tests
website/
  src/App.jsx      # Learning site: primer, tips, API Explorer
  src/backendSamples.js  # GraphQL server samples in 10 backend languages
  vite.config.js   # Vite config (GitHub Pages base path + /graphql dev proxy)
.github/workflows/
  ci.yml           # Backend tests plus website lint/build on push and PRs
  deploy-pages.yml # Builds website/ and publishes it to GitHub Pages
```

## Installation and running locally

```bash
git clone https://github.com/charles2ke/GraphQL.git
cd GraphQL
npm install
npm start          # or: npm run dev  (restarts on file changes)
```

The server listens on port `4000` by default (override with the `PORT`
environment variable):

- GraphQL endpoint: <http://localhost:4000/graphql>
- Liveness check: <http://localhost:4000/health>
- Readiness check (per-upstream): <http://localhost:4000/ready>
- Metrics (Prometheus text): <http://localhost:4000/metrics>
- Excel exports: <http://localhost:4000/export>
- Streaming (SSE) endpoint: <http://localhost:4000/graphql/stream>

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

## API

| Type | Operation | Description |
| --- | --- | --- |
| Query | `users` | List all users |
| Query | `user(id: ID!)` | Fetch a single user, `null` when unknown |
| Query | `posts` | List all posts |
| Query | `post(id: ID!)` | Fetch a single post, `null` when unknown |
| Query | `portfolioOverview(accountId, from, to, limit, offset)` | Fetch finance accounts, positions, snapshots, and P/L |
| Query | `tradeHistory(accountId, symbol, side, status, from, to, limit, offset)` | Fetch trades/orders enriched with tax events |
| Query | `taxEstimate(taxYear, accountId, symbol, from, to, limit, offset)` | Estimate tax from tax-relevant trading activity |
| Mutation | `createUser(name, email)` | Create a user |
| Mutation | `createPost(title, content, authorId)` | Create a post for an existing user |
| Subscription | `userCreated` | Streams every newly created user |
| Subscription | `postCreated(authorId)` | Streams new posts, optionally for one author |

The finance operations are documented in detail under
[Finance cluster integration](#finance-cluster-integration); subscriptions are
delivered over SSE, see [Streaming](#streaming).

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

## Streaming

Subscriptions can be streamed over Server-Sent Events at `POST|GET
/graphql/stream`. **`GET` is read-only streaming**: it only accepts `query`
and `subscription` operations, taken from plain `query`/`variables`/
`operationName` query-string parameters, and is therefore safe to treat as a
"simple" cross-origin request. This is *not* the same payload contract as
`/graphql` — **mutations sent with `GET` are rejected with `405 Method Not
Allowed`** so a mutating operation can never be triggered from a plain
cross-site navigation or `<img>`/`<script>` style request.

**Mutations must be sent with `POST`**, using a request shape that a simple
cross-origin form or link cannot forge: a `Content-Type` such as
`application/json` (which is not a CORS "simple" content type) and/or a
custom header (e.g. `X-Requested-With`), matching the CSRF-prevention shape
that Apollo Server enforces by default on `/graphql`. Requests that omit
this shape should be rejected before they reach resolvers.

SSE keeps the transport plain HTTP — no WebSocket upgrade or extra service is
required.

```bash
# Stream new users as they are created (query/subscription only over GET)
curl -N -H 'Accept: text/event-stream' \
  --get http://localhost:4000/graphql/stream \
  --data-urlencode 'query=subscription { userCreated { id name email } }'

# Mutations must go to /graphql over POST with a non-simple Content-Type
curl -X POST http://localhost:4000/graphql \
  -H 'Content-Type: application/json' \
  -d '{"query":"mutation { createUser(name: \"Grace\", email: \"grace@example.com\") { id } }"}'
```

Each emitted result arrives as an `event: next` frame carrying the usual
GraphQL response body, and the stream finishes with `event: complete`.
Queries sent to `/graphql/stream` produce exactly one `next` frame followed
by `complete`. Comment frames (`: ping`) act as heartbeats so idle
connections survive proxies, and a subscription is torn down as soon as the
client disconnects.

Events are dispatched by an in-process pub/sub (`src/streaming/pubsub.js`).
It is intentionally dependency-free, which means subscribers only see events
published by their own instance; swap that module for a Redis/NATS-backed
implementation with the same `publish`/`subscribe` contract to run more than
one replica.

## CORS

`/graphql`, `/graphql/stream`, and `/export` are served behind an **explicit
origin allow-list** — a wildcard (`*`) `Access-Control-Allow-Origin` is never
emitted — so that only trusted front-ends can read responses cross-origin.

The allow-list is built in `src/config/cors.js` from the
`CORS_ALLOWED_ORIGINS` environment variable and applied by `src/index.js`:

```bash
CORS_ALLOWED_ORIGINS='https://app.example.com,https://admin.example.com' npm start
```

```js
import { loadCorsOptions } from './config/cors.js';

const corsOptions = loadCorsOptions();
app.use('/graphql', cors(corsOptions), /* ... */);
```

An allowed `Origin` is echoed back verbatim; any other origin receives **no**
CORS headers, so the browser blocks the response. When
`CORS_ALLOWED_ORIGINS` is unset every cross-origin read is denied — this is
the secure default, so the variable must be set for browser front-ends that
live on a different origin. Requests without an `Origin` header (curl,
server-to-server calls) are unaffected.

## Excel export

Any dataset the API serves can be downloaded as an Excel workbook (`.xlsx`) —
useful for sharing a portfolio snapshot or trade history with a spreadsheet.
The files are generated in-process, so no extra dependency or service is needed.

```bash
curl http://localhost:4000/export                       # list datasets
curl -O -J http://localhost:4000/export/trades.xlsx     # download a workbook
```

| Dataset | Path | Sheets |
| --- | --- | --- |
| `users` | `/export/users.xlsx` | Users (with post counts) |
| `posts` | `/export/posts.xlsx` | Posts (with author names) |
| `portfolio` | `/export/portfolio.xlsx` | Accounts, Positions, Performance |
| `trades` | `/export/trades.xlsx` | Trades, Orders, Tax Events |
| `tax-estimate` | `/export/tax-estimate.xlsx?taxYear=2024` | Summary, Tax Events |

Finance exports accept the same query parameters as their GraphQL counterparts
(`accountId`, `symbol`, `side`, `status`, `from`, `to`, `limit`, `offset`, and
`taxYear`, which is required for `tax-estimate`):

```bash
curl -O -J 'http://localhost:4000/export/trades.xlsx?accountId=acct-1&symbol=AAPL&limit=50'
```

When upstream connectors return partial data, the workbook gains an extra
`Errors` sheet describing each failure instead of hiding the gap.

## Finance cluster integration

This service exposes a unified finance GraphQL surface over three upstream
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
`src/config/finance.js` (the last three rows are read elsewhere but listed here
for a single view of the service configuration):

| Variable | Description | Default |
| --- | --- | --- |
| `PORT` | HTTP port the service listens on | `4000` |
| `OPENTRADING_ENDPOINT` | OpenTrading endpoint placeholder | `mock://opentrading` |
| `OPENTRADING_API_KEY` | OpenTrading credential placeholder | empty |
| `PORTFOLIO_WATCHER_ENDPOINT` | Portfolio-Watcher endpoint placeholder | `mock://portfolio-watcher` |
| `PORTFOLIO_WATCHER_API_KEY` | Portfolio-Watcher credential placeholder | empty |
| `TAX_BREAK_ENDPOINT` | tax-break endpoint placeholder | `mock://tax-break` |
| `TAX_BREAK_API_KEY` | tax-break credential placeholder | empty |
| `FINANCE_CACHE_TTL_MS` | Resolver cache TTL | `1000` |
| `FINANCE_CACHE_STORE` | Cache strategy: `memory`, `file` (persistent), or `shared` | `memory` |
| `FINANCE_CACHE_FILE` | Cache file used when `FINANCE_CACHE_STORE=file` | `.cache/finance-cache.json` |
| `FINANCE_CACHE_SHARED_MODULE` | Optional shared cache provider module path used when `FINANCE_CACHE_STORE=shared` | empty |
| `FINANCE_HTTP_TIMEOUT_MS` | Per-request upstream timeout | `5000` |
| `FINANCE_HTTP_MAX_RETRIES` | Retries for timeouts, 429s, and 5xx responses | `2` |
| `FINANCE_DEFAULT_PAGE_SIZE` | Default page size when `limit` is omitted | `25` |
| `FINANCE_MAX_PAGE_SIZE` | Upper bound applied to any requested `limit` | `100` |
| `LOG_LEVEL` | Structured log level (`debug`/`info`/`warn`/`error`) | `info` |
| `CORS_ALLOWED_ORIGINS` | Comma-separated list of origins allowed to read `/graphql`, `/graphql/stream`, and `/export` cross-origin | empty (all cross-origin reads denied) |

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

## Notes

Data lives in memory only, so every restart resets the service to its seed data
(two users and two posts). Swapping `src/data/store.js` for a database-backed
implementation is enough to persist data — the resolvers receive the store through
the GraphQL context.

## Security and license

Report vulnerabilities as described in [SECURITY.md](SECURITY.md). This project
is licensed under the [Apache License 2.0](LICENSE).
