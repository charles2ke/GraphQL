# GraphQL field guide (website)

The React + Vite learning website for this repository. It contains a GraphQL
primer, GraphQL server samples for ten backend languages, operation-writing tips,
and an interactive API Explorer that runs queries against the demo service in
`../src`.

Published at <https://charles2ke.github.io/GraphQL/>.

## Development

```bash
npm install
npm run dev
```

Start the API server from the repository root (`npm start`, port `4000`) so the
API Explorer has a backend; Vite proxies `/graphql` (including the
`/graphql/stream` SSE endpoint) to it during development. The Explorer lives at
`/#explorer`.

To target a different API, set `VITE_GRAPHQL_URL` to its GraphQL endpoint;
subscriptions are sent to the same URL with `/stream` appended:

```bash
VITE_GRAPHQL_URL=https://example.com/graphql npm run dev
```

## API Explorer

- Grouped examples for users and posts, finance, and subscriptions, defined in
  `src/explorerExamples.js` together with the list of root fields shown in the
  sidebar. The root test suite (`test/website-examples.test.js`) runs every
  example against the real schema and fails if the field list drifts.
- A **Variables (JSON)** editor; malformed JSON is reported without sending a
  request.
- Subscriptions stream live over Server-Sent Events, with an event counter and a
  **Stop** button. The latest 50 events are shown, newest first.
- <kbd>Ctrl</kbd>/<kbd>⌘</kbd> + <kbd>Enter</kbd> runs the operation from either
  editor. The response header shows the HTTP status, duration, and the
  `X-Request-Id` to look up in the server logs.

Requests are made by `src/graphqlClient.js`, a dependency-free `fetch` and SSE
client with unit tests in `src/graphqlClient.test.js`.

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Oxlint |
| `npm test` | Unit tests with the built-in `node:test` runner |

## Deployment

`GITHUB_PAGES=true` sets the Vite `base` to `/GraphQL/`, matching the project
Pages URL:

```bash
GITHUB_PAGES=true npm run build
```

The `.github/workflows/deploy-pages.yml` workflow runs this build and publishes
`dist/` to GitHub Pages on every push to `main` that touches `website/`, and on
manual dispatch.
