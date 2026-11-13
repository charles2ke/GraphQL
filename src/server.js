import { ApolloServer } from '@apollo/server';

import { createObservabilityPlugin } from './observability/apolloPlugin.js';
import { createSchema } from './schema.js';

/**
 * Builds an Apollo Server instance for the demo schema.
 * Exported separately from the HTTP bootstrap so tests can run queries
 * against the server without opening a port.
 *
 * `introspection` and `stopOnTerminationSignals` fall back to Apollo's
 * defaults when omitted; `validationRules` run in addition to the GraphQL
 * spec rules.
 */
export function createApolloServer({
  logger,
  metrics,
  enableObservability = false,
  plugins = [],
  schema = createSchema(),
  introspection,
  validationRules = [],
  stopOnTerminationSignals,
} = {}) {
  const observabilityPlugins = enableObservability ? [createObservabilityPlugin({ logger, metrics })] : [];

  return new ApolloServer({
    schema,
    introspection,
    validationRules,
    stopOnTerminationSignals,
    plugins: [...observabilityPlugins, ...plugins],
  });
}
