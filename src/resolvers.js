import { GraphQLError } from 'graphql';

import { pubsub as defaultPubSub, TOPICS } from './streaming/pubsub.js';
import { validateFinanceArgs, validatePagination } from './validation/financeArgs.js';
import { parsePostInput, parseUserInput } from './validation/userPostArgs.js';

/** Wraps an async iterator, forwarding only the payloads matching `predicate`. */
async function* filterAsyncIterator(source, predicate) {
  for await (const payload of source) {
    if (predicate(payload)) yield payload;
  }
}

/** Subscribes to a post topic, optionally narrowed to one author. */
function subscribeToPosts(topic, field, authorId, { pubsub = defaultPubSub, signal }) {
  const source = pubsub.subscribe(topic, { signal });
  if (!authorId) return source;
  return filterAsyncIterator(source, (payload) => payload?.[field]?.authorId === authorId);
}

/**
 * Subscription events are resolved when a subscriber pulls them, which can be
 * after the author was deleted (e.g. `deletePost` then `deleteUser` in one
 * request), so the non-null author is captured at publish time.
 */
function postEvent(store, post) {
  return { ...post, author: store.getUser(post.authorId) };
}

function invalidInput(issues) {
  return new GraphQLError(`Invalid input: ${issues.join('; ')}.`, {
    extensions: { code: 'BAD_USER_INPUT', category: 'validation', details: issues },
  });
}

function notFound(type, id) {
  return new GraphQLError(`${type} with id "${id}" does not exist.`, { extensions: { code: 'NOT_FOUND' } });
}

function conflict(message) {
  return new GraphQLError(message, { extensions: { code: 'CONFLICT' } });
}

/** Returns the parsed values or throws one error listing every issue. */
function valuesOrThrow({ values, issues }) {
  if (issues.length > 0) throw invalidInput(issues);
  return values;
}

function paginationOrThrow(args) {
  const issues = validatePagination(args);
  if (issues.length > 0) throw invalidInput(issues);
  return args;
}

/** Emails are unique case-insensitively; `exceptId` lets a user keep their own. */
function assertEmailAvailable(store, email, exceptId) {
  const owner = store.findUserByEmail(email);
  if (owner && owner.id !== exceptId) throw conflict('Email is already in use by another user.');
}

async function runFinanceResolver(name, args, context, resolve, options = {}) {
  const issues = validateFinanceArgs(args, options);
  if (issues.length > 0) {
    context.metrics?.increment?.('finance_resolver_total', { resolver: name, outcome: 'validation_error' });
    throw new GraphQLError('Invalid finance query arguments.', {
      extensions: { code: 'BAD_USER_INPUT', category: 'validation', details: issues },
    });
  }

  const execute = () =>
    context.metrics?.time
      ? context.metrics.time('finance_resolver', { resolver: name }, resolve)
      : resolve();

  try {
    const result = await execute();
    context.logger?.info?.('finance resolver completed', { resolver: name, outcome: 'success' });
    return result;
  } catch (error) {
    if (error instanceof GraphQLError) throw error;
    context.logger?.error?.('finance resolver failed', { resolver: name, category: 'internal', error: error?.message ?? String(error) });
    throw new GraphQLError('Finance query failed. Please retry later.', {
      extensions: { code: 'INTERNAL_SERVER_ERROR', category: 'internal' },
    });
  }
}

/**
 * Resolvers read and write through the store provided on the GraphQL context,
 * which keeps them independent from the concrete storage implementation.
 */
export const resolvers = {
  Query: {
    users: (_parent, args, { store }) => store.listUsers(paginationOrThrow(args)),
    user: (_parent, { id }, { store }) => store.getUser(id),
    posts: (_parent, args, { store }) => store.listPosts(paginationOrThrow(args)),
    post: (_parent, { id }, { store }) => store.getPost(id),
    portfolioOverview: (_parent, args, context) => runFinanceResolver('portfolioOverview', args, context, () => context.finance.portfolioOverview(args)),
    tradeHistory: (_parent, args, context) => runFinanceResolver('tradeHistory', args, context, () => context.finance.tradeHistory(args)),
    taxEstimate: (_parent, args, context) =>
      runFinanceResolver('taxEstimate', args, context, () => context.finance.taxEstimate(args), { requireTaxYear: true }),
  },

  Mutation: {
    createUser: (_parent, args, { store, pubsub = defaultPubSub }) => {
      const { name, email } = valuesOrThrow(parseUserInput(args));
      assertEmailAvailable(store, email);

      const user = store.createUser({ name, email });
      pubsub.publish(TOPICS.USER_CREATED, { userCreated: user });
      return user;
    },

    updateUser: (_parent, { id, ...changes }, { store, pubsub = defaultPubSub }) => {
      const values = valuesOrThrow(parseUserInput(changes, { partial: true }));
      if (!store.getUser(id)) throw notFound('User', id);
      if (values.email !== undefined) assertEmailAvailable(store, values.email, id);

      const user = store.updateUser(id, values);
      pubsub.publish(TOPICS.USER_UPDATED, { userUpdated: user });
      return user;
    },

    deleteUser: (_parent, { id }, { store, pubsub = defaultPubSub }) => {
      if (!store.getUser(id)) throw notFound('User', id);
      // Restrict rather than cascade: every Post needs an existing author, and
      // silently deleting someone's posts is too surprising for one call.
      const postCount = store.listPostsByAuthor(id).length;
      if (postCount > 0) {
        throw conflict(`User with id "${id}" still has ${postCount} post(s); delete them before deleting the user.`);
      }

      const user = store.deleteUser(id);
      pubsub.publish(TOPICS.USER_DELETED, { userDeleted: user });
      return user;
    },

    createPost: (_parent, { authorId, ...fields }, { store, pubsub = defaultPubSub }) => {
      const { title, content } = valuesOrThrow(parsePostInput(fields));
      // Referential integrity has to be enforced by hand with an in-memory store.
      if (!store.getUser(authorId)) {
        throw new GraphQLError(`User with id "${authorId}" does not exist.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const post = store.createPost({ title, content, authorId });
      pubsub.publish(TOPICS.POST_CREATED, { postCreated: postEvent(store, post) });
      return post;
    },

    updatePost: (_parent, { id, ...changes }, { store, pubsub = defaultPubSub }) => {
      const values = valuesOrThrow(parsePostInput(changes, { partial: true }));
      if (!store.getPost(id)) throw notFound('Post', id);

      const post = store.updatePost(id, values);
      pubsub.publish(TOPICS.POST_UPDATED, { postUpdated: postEvent(store, post) });
      return post;
    },

    deletePost: (_parent, { id }, { store, pubsub = defaultPubSub }) => {
      const post = store.deletePost(id);
      if (!post) throw notFound('Post', id);

      pubsub.publish(TOPICS.POST_DELETED, { postDeleted: postEvent(store, post) });
      return post;
    },
  },

  Subscription: {
    userCreated: {
      subscribe: (_parent, _args, { pubsub = defaultPubSub, signal }) => pubsub.subscribe(TOPICS.USER_CREATED, { signal }),
    },

    userUpdated: {
      subscribe: (_parent, _args, { pubsub = defaultPubSub, signal }) => pubsub.subscribe(TOPICS.USER_UPDATED, { signal }),
    },

    userDeleted: {
      subscribe: (_parent, _args, { pubsub = defaultPubSub, signal }) => pubsub.subscribe(TOPICS.USER_DELETED, { signal }),
    },

    postCreated: {
      subscribe: (_parent, { authorId }, context) => subscribeToPosts(TOPICS.POST_CREATED, 'postCreated', authorId, context),
    },

    postUpdated: {
      subscribe: (_parent, { authorId }, context) => subscribeToPosts(TOPICS.POST_UPDATED, 'postUpdated', authorId, context),
    },

    postDeleted: {
      subscribe: (_parent, { authorId }, context) => subscribeToPosts(TOPICS.POST_DELETED, 'postDeleted', authorId, context),
    },
  },

  User: {
    posts: (user, _args, { store }) => store.listPostsByAuthor(user.id),
  },

  Post: {
    // Subscription events carry the author captured when they were published.
    author: (post, _args, { store }) => post.author ?? store.getUser(post.authorId),
  },
};
