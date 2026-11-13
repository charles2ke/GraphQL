// Example operations and the root-field reference shown in the API Explorer.
// test/website-examples.test.js (repository root) runs every example against
// the real schema and checks `schemaFields` against it, so this file cannot
// silently drift from the API.

export const exampleGroups = ['Users & posts', 'Finance', 'Subscriptions']

export const explorerExamples = [
  {
    id: 'users',
    group: 'Users & posts',
    label: 'List users',
    query: `query Users {
  users {
    id
    name
    email
    posts { id title }
  }
}`,
  },
  {
    id: 'search-users',
    group: 'Users & posts',
    label: 'Search users',
    query: `query SearchUsers($search: String, $limit: Int) {
  users(search: $search, limit: $limit) {
    id
    name
    email
  }
}`,
    variables: { search: 'ada', limit: 5 },
  },
  {
    id: 'posts',
    group: 'Users & posts',
    label: 'Posts by author',
    query: `query PostsByAuthor($authorId: ID) {
  posts(authorId: $authorId) {
    id
    title
    content
    author { name }
  }
}`,
    variables: { authorId: '1' },
  },
  {
    id: 'create-user',
    group: 'Users & posts',
    label: 'Create user',
    query: `mutation CreateUser($name: String!, $email: String!) {
  createUser(name: $name, email: $email) {
    id
    name
    email
  }
}`,
    variables: { name: 'Grace Hopper', email: 'grace@example.com' },
  },
  {
    id: 'update-user',
    group: 'Users & posts',
    label: 'Update user',
    query: `mutation UpdateUser($id: ID!, $name: String) {
  updateUser(id: $id, name: $name) {
    id
    name
    email
  }
}`,
    variables: { id: '1', name: 'Augusta Ada King' },
  },
  {
    id: 'create-post',
    group: 'Users & posts',
    label: 'Create post',
    query: `mutation CreatePost($title: String!, $content: String!, $authorId: ID!) {
  createPost(title: $title, content: $content, authorId: $authorId) {
    id
    title
    author { name }
  }
}`,
    variables: { title: 'Notes on the Analytical Engine', content: 'It weaves algebraic patterns.', authorId: '1' },
  },
  {
    id: 'delete-post',
    group: 'Users & posts',
    label: 'Delete post',
    query: `mutation DeletePost($id: ID!) {
  deletePost(id: $id) {
    id
    title
  }
}`,
    variables: { id: '2' },
  },
  {
    id: 'portfolio',
    group: 'Finance',
    label: 'Portfolio overview',
    query: `query Portfolio {
  portfolioOverview {
    currency
    totalMarketValue
    totalUnrealizedPnL
    positions { symbol quantity marketValue unrealizedPnL }
    errors { source code message }
  }
}`,
  },
  {
    id: 'trade-history',
    group: 'Finance',
    label: 'Trade history',
    query: `query TradeHistory($symbol: String, $limit: Int) {
  tradeHistory(symbol: $symbol, limit: $limit) {
    trades { id side quantity price executedAt }
    taxEvents { tradeId realizedGain holdingPeriod }
    pageInfo { totalCount hasNextPage }
    errors { source code message }
  }
}`,
    variables: { symbol: 'AAPL', limit: 10 },
  },
  {
    id: 'tax-estimate',
    group: 'Finance',
    label: 'Tax estimate',
    query: `query TaxEstimate($taxYear: Int!) {
  taxEstimate(taxYear: $taxYear) {
    taxYear
    realizedGain
    estimatedTax
    events { symbol realizedGain occurredAt }
  }
}`,
    variables: { taxYear: 2026 },
  },
  {
    id: 'user-created',
    group: 'Subscriptions',
    label: 'User created',
    query: `subscription OnUserCreated {
  userCreated {
    id
    name
    email
  }
}`,
  },
  {
    id: 'post-created',
    group: 'Subscriptions',
    label: 'Post created',
    query: `subscription OnPostCreated($authorId: ID) {
  postCreated(authorId: $authorId) {
    id
    title
    author { name }
  }
}`,
    variables: { authorId: '1' },
  },
]

/** Root fields and their arguments, grouped by operation type. */
export const schemaFields = {
  Query: {
    users: ['search', 'limit', 'offset'],
    user: ['id'],
    posts: ['search', 'authorId', 'limit', 'offset'],
    post: ['id'],
    portfolioOverview: ['accountId', 'from', 'to', 'limit', 'offset'],
    tradeHistory: ['accountId', 'symbol', 'side', 'status', 'from', 'to', 'limit', 'offset'],
    taxEstimate: ['taxYear', 'accountId', 'symbol', 'from', 'to', 'limit', 'offset'],
  },
  Mutation: {
    createUser: ['name', 'email'],
    updateUser: ['id', 'name', 'email'],
    deleteUser: ['id'],
    createPost: ['title', 'content', 'authorId'],
    updatePost: ['id', 'title', 'content'],
    deletePost: ['id'],
  },
  Subscription: {
    userCreated: [],
    userUpdated: [],
    userDeleted: [],
    postCreated: ['authorId'],
    postUpdated: ['authorId'],
    postDeleted: ['authorId'],
  },
}
