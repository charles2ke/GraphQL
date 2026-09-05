import { ApolloServer } from '@apollo/server';

import { createObservabilityPlugin } from './observability/apolloPlugin.js';
import { resolvers } from './resolvers.js';
import { typeDefs } from './schema.js';

/**
 * Builds an Apollo Server instance for the demo schema.
 * Exported separately from the HTTP bootstrap so tests can run queries
 * against the server without opening a port.
 */
export function createApolloServer({ logger, metrics, enableObservability = false, plugins = [] } = {}) {
  const observabilityPlugins = enableObservability ? [createObservabilityPlugin({ logger, metrics })] : [];

  return new ApolloServer({
    typeDefs,
    resolvers,
    plugins: [...observabilityPlugins, ...plugins],
  });
}
