import { GraphQLError } from 'graphql';

import { pubsub as defaultPubSub, TOPICS } from './streaming/pubsub.js';
import { validateFinanceArgs } from './validation/financeArgs.js';

/** Wraps an async iterator, forwarding only the payloads matching `predicate`. */
async function* filterAsyncIterator(source, predicate) {
  for await (const payload of source) {
    if (predicate(payload)) yield payload;
  }
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
    users: (_parent, _args, { store }) => store.listUsers(),
    user: (_parent, { id }, { store }) => store.getUser(id),
    posts: (_parent, _args, { store }) => store.listPosts(),
    post: (_parent, { id }, { store }) => store.getPost(id),
    portfolioOverview: (_parent, args, context) => runFinanceResolver('portfolioOverview', args, context, () => context.finance.portfolioOverview(args)),
    tradeHistory: (_parent, args, context) => runFinanceResolver('tradeHistory', args, context, () => context.finance.tradeHistory(args)),
    taxEstimate: (_parent, args, context) =>
      runFinanceResolver('taxEstimate', args, context, () => context.finance.taxEstimate(args), { requireTaxYear: true }),
  },

  Mutation: {
    createUser: (_parent, { name, email }, { store, pubsub = defaultPubSub }) => {
      const user = store.createUser({ name, email });
      pubsub.publish(TOPICS.USER_CREATED, { userCreated: user });
      return user;
    },

    createPost: (_parent, { title, content, authorId }, { store, pubsub = defaultPubSub }) => {
      // Referential integrity has to be enforced by hand with an in-memory store.
      if (!store.getUser(authorId)) {
        throw new GraphQLError(`User with id "${authorId}" does not exist.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      const post = store.createPost({ title, content, authorId });
      pubsub.publish(TOPICS.POST_CREATED, { postCreated: post });
      return post;
    },
  },

  Subscription: {
    userCreated: {
      subscribe: (_parent, _args, { pubsub = defaultPubSub, signal }) => pubsub.subscribe(TOPICS.USER_CREATED, { signal }),
    },

    postCreated: {
      subscribe: (_parent, { authorId }, { pubsub = defaultPubSub, signal }) => {
        const source = pubsub.subscribe(TOPICS.POST_CREATED, { signal });
        if (!authorId) return source;
        return filterAsyncIterator(source, (payload) => payload?.postCreated?.authorId === authorId);
      },
    },
  },

  User: {
    posts: (user, _args, { store }) => store.listPostsByAuthor(user.id),
  },

  Post: {
    author: (post, _args, { store }) => store.getUser(post.authorId),
  },
};
