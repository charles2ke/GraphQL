import { GraphQLError } from 'graphql';

import { validateFinanceArgs } from './validation/financeArgs.js';

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
    createUser: (_parent, { name, email }, { store }) => store.createUser({ name, email }),

    createPost: (_parent, { title, content, authorId }, { store }) => {
      // Referential integrity has to be enforced by hand with an in-memory store.
      if (!store.getUser(authorId)) {
        throw new GraphQLError(`User with id "${authorId}" does not exist.`, {
          extensions: { code: 'BAD_USER_INPUT' },
        });
      }

      return store.createPost({ title, content, authorId });
    },
  },

  User: {
    posts: (user, _args, { store }) => store.listPostsByAuthor(user.id),
  },

  Post: {
    author: (post, _args, { store }) => store.getUser(post.authorId),
  },
};
