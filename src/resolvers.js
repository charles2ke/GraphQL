import { GraphQLError } from 'graphql';

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
    portfolioOverview: (_parent, args, { finance }) => finance.portfolioOverview(args),
    tradeHistory: (_parent, args, { finance }) => finance.tradeHistory(args),
    taxEstimate: (_parent, args, { finance }) => finance.taxEstimate(args),
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
