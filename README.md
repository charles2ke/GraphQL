# GraphQL

Make any microservice have a GraphQL implementation.

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
  data/store.js    # In-memory data store with seed data
test/
  graphql.test.js  # API tests executed against the schema
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

The React learning website includes a GraphQL primer, practical tips, and an
interactive API Explorer that runs requests against this service.

The site is published with GitHub Pages at
<https://charles2ke.github.io/GraphQL/>. Changes under `website/` are deployed
automatically when they are merged to `main`; the workflow can also be run
manually from GitHub Actions.

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
GITHUB_PAGES=true npm run build
```

## Tests

```bash
npm test
```

## API

| Operation | Description |
| --- | --- |
| `users` | List all users |
| `user(id: ID!)` | Fetch a single user, `null` when unknown |
| `posts` | List all posts |
| `post(id: ID!)` | Fetch a single post, `null` when unknown |
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
