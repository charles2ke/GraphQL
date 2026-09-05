import { logger as defaultLogger } from './logger.js';
import { metrics as defaultMetrics } from './metrics.js';

/**
 * Apollo plugin emitting one structured log line and latency/outcome metrics
 * per GraphQL operation, which is the minimum needed to alert on error rates
 * and slow queries in production.
 */
export function createObservabilityPlugin({ logger = defaultLogger, metrics = defaultMetrics } = {}) {
  return {
    async requestDidStart(requestContext) {
      const startedAt = Date.now();
      const requestId = requestContext.request.http?.headers?.get?.('x-request-id') ?? undefined;

      return {
        async willSendResponse(context) {
          const durationMs = Date.now() - startedAt;
          const operationName = context.operationName ?? context.operation?.name?.value ?? 'anonymous';
          const errors = context.errors ?? context.response?.body?.singleResult?.errors ?? [];
          const outcome = errors.length > 0 ? 'failure' : 'success';

          metrics.observe('graphql_operation_duration_ms', durationMs, { operationName, outcome });
          metrics.increment('graphql_operation_total', { operationName, outcome });
          if (errors.length > 0) metrics.increment('graphql_operation_errors_total', { operationName }, errors.length);

          logger[outcome === 'failure' ? 'error' : 'info']('graphql operation completed', {
            requestId,
            operationName,
            operationType: context.operation?.operation,
            durationMs,
            outcome,
            errorCount: errors.length,
            errorCodes: errors.map((error) => error.extensions?.code ?? 'INTERNAL_SERVER_ERROR'),
          });
        },
      };
    },
  };
}
