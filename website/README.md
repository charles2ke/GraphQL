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
API Explorer has a backend; Vite proxies `/graphql` to it during development.
The Explorer lives at `/#explorer`.

To target a different API, set `VITE_GRAPHQL_URL` to its GraphQL endpoint:

```bash
VITE_GRAPHQL_URL=https://example.com/graphql npm run dev
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Vite dev server with HMR |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Serve the production build |
| `npm run lint` | Oxlint |

## Deployment

`GITHUB_PAGES=true` sets the Vite `base` to `/GraphQL/`, matching the project
Pages URL:

```bash
GITHUB_PAGES=true npm run build
```

The `.github/workflows/deploy-pages.yml` workflow runs this build and publishes
`dist/` to GitHub Pages on every push to `main` that touches `website/`, and on
manual dispatch.
