/**
 * In-memory data store.
 *
 * Keeping the data in memory means the service runs without any external
 * dependency (no database required). The store is intentionally tiny and
 * exposes a small, database-like API so that resolvers stay simple.
 */

/** Seed data used whenever a fresh store is created. */
const seedUsers = [
  { id: '1', name: 'Ada Lovelace', email: 'ada@example.com' },
  { id: '2', name: 'Alan Turing', email: 'alan@example.com' },
];

const seedPosts = [
  {
    id: '1',
    title: 'Hello GraphQL',
    content: 'A first post about querying exactly what you need.',
    authorId: '1',
  },
  {
    id: '2',
    title: 'On computable numbers',
    content: 'Notes about machines that compute.',
    authorId: '2',
  },
];

export function createStore() {
  const users = seedUsers.map((user) => ({ ...user }));
  const posts = seedPosts.map((post) => ({ ...post }));

  // Ids are handed out sequentially, continuing after the seed data.
  let nextUserId = users.length + 1;
  let nextPostId = posts.length + 1;

  return {
    listUsers: () => [...users],
    getUser: (id) => users.find((user) => user.id === id) ?? null,
    listPosts: () => [...posts],
    getPost: (id) => posts.find((post) => post.id === id) ?? null,
    listPostsByAuthor: (authorId) => posts.filter((post) => post.authorId === authorId),

    createUser: ({ name, email }) => {
      const user = { id: String(nextUserId++), name, email };
      users.push(user);
      return user;
    },

    createPost: ({ title, content, authorId }) => {
      const post = { id: String(nextPostId++), title, content, authorId };
      posts.push(post);
      return post;
    },
  };
}

/** Default store instance shared by the running server. */
export const store = createStore();
