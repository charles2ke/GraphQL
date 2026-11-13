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

/** Lower-cased search term, or `null` when no filtering was requested. */
function normalizeSearch(search) {
  const term = typeof search === 'string' ? search.trim().toLowerCase() : '';
  return term === '' ? null : term;
}

const containsTerm = (term, ...values) => values.some((value) => value.toLowerCase().includes(term));

/** Offset/limit slice; an omitted limit returns everything after the offset. */
function paginate(items, { limit, offset } = {}) {
  const start = offset ?? 0;
  return limit === undefined || limit === null ? items.slice(start) : items.slice(start, start + limit);
}

/**
 * Replaces the record with `id` by a copy carrying the provided changes.
 * Records are swapped rather than mutated so payloads that were already handed
 * out (e.g. queued subscription events) keep their original values.
 */
function replaceById(records, id, changes) {
  const index = records.findIndex((record) => record.id === id);
  if (index === -1) return null;

  const defined = Object.entries(changes).filter(([, value]) => value !== undefined && value !== null);
  records[index] = { ...records[index], ...Object.fromEntries(defined) };
  return records[index];
}

function removeById(records, id) {
  const index = records.findIndex((record) => record.id === id);
  return index === -1 ? null : records.splice(index, 1)[0];
}

export function createStore() {
  const users = seedUsers.map((user) => ({ ...user }));
  const posts = seedPosts.map((post) => ({ ...post }));

  // Ids are handed out sequentially, continuing after the seed data, and are
  // never reused after a delete.
  let nextUserId = users.length + 1;
  let nextPostId = posts.length + 1;

  return {
    /** Users matching a case-insensitive name/email search, then paginated. */
    listUsers: ({ search, limit, offset } = {}) => {
      const term = normalizeSearch(search);
      const matching = term ? users.filter((user) => containsTerm(term, user.name, user.email)) : users;
      return paginate(matching, { limit, offset });
    },
    getUser: (id) => users.find((user) => user.id === id) ?? null,
    /** Case-insensitive lookup used to keep emails unique. */
    findUserByEmail: (email) => {
      const normalized = String(email).trim().toLowerCase();
      return users.find((user) => user.email.toLowerCase() === normalized) ?? null;
    },
    /** Posts filtered by author and a case-insensitive title/content search, then paginated. */
    listPosts: ({ search, authorId, limit, offset } = {}) => {
      const term = normalizeSearch(search);
      const matching = posts.filter(
        (post) =>
          (authorId === undefined || authorId === null || post.authorId === authorId) &&
          (!term || containsTerm(term, post.title, post.content))
      );
      return paginate(matching, { limit, offset });
    },
    getPost: (id) => posts.find((post) => post.id === id) ?? null,
    listPostsByAuthor: (authorId) => posts.filter((post) => post.authorId === authorId),

    createUser: ({ name, email }) => {
      const user = { id: String(nextUserId++), name, email };
      users.push(user);
      return user;
    },

    /** Applies the provided name/email; returns `null` for an unknown id. */
    updateUser: (id, { name, email } = {}) => replaceById(users, id, { name, email }),

    /** Removes and returns the user, or `null` for an unknown id. */
    deleteUser: (id) => removeById(users, id),

    createPost: ({ title, content, authorId }) => {
      const post = { id: String(nextPostId++), title, content, authorId };
      posts.push(post);
      return post;
    },

    /** Applies the provided title/content; returns `null` for an unknown id. */
    updatePost: (id, { title, content } = {}) => replaceById(posts, id, { title, content }),

    /** Removes and returns the post, or `null` for an unknown id. */
    deletePost: (id) => removeById(posts, id),
  };
}

/** Default store instance shared by the running server. */
export const store = createStore();
