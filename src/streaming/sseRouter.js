import express from 'express';
import { GraphQLError, execute, getOperationAST, parse, subscribe, validate } from 'graphql';

import { createSchema } from '../schema.js';

const DEFAULT_HEARTBEAT_MS = 15000;
const SSE_HEADERS = {
  'content-type': 'text/event-stream',
  'cache-control': 'no-cache, no-transform',
  connection: 'keep-alive',
  // Disable proxy buffering so events reach the client immediately.
  'x-accel-buffering': 'no',
};

function readOperation(req) {
  const source = req.method === 'GET' ? req.query : req.body ?? {};
  const { query, operationName } = source;
  let { variables } = source;

  if (typeof variables === 'string') {
    try {
      variables = JSON.parse(variables);
    } catch {
      throw new GraphQLError('Invalid "variables" parameter: expected JSON.', {
        extensions: { code: 'BAD_USER_INPUT' },
      });
    }
  }

  if (typeof query !== 'string' || query.trim() === '') {
    throw new GraphQLError('A GraphQL "query" is required.', { extensions: { code: 'BAD_USER_INPUT' } });
  }

  return { query, variables: variables ?? undefined, operationName: operationName ?? undefined };
}

function writeEvent(res, event, data) {
  res.write(`event: ${event}\n`);
  if (data !== undefined) res.write(`data: ${JSON.stringify(data)}\n`);
  res.write('\n');
}

/**
 * Express router streaming GraphQL results over Server-Sent Events.
 *
 * `GET|POST /graphql/stream` accepts the usual `query`/`variables`/
 * `operationName` payload. Subscriptions stream one `next` event per emitted
 * result and finish with `complete`; queries and mutations are executed once
 * and streamed as a single `next` + `complete` pair, so a single client
 * transport covers every operation type.
 */
export function createStreamRouter({
  schema = createSchema(),
  contextValue,
  heartbeatMs = DEFAULT_HEARTBEAT_MS,
  logger,
  metrics,
} = {}) {
  const router = express.Router();

  async function handle(req, res) {
    let operation;
    try {
      operation = readOperation(req);
    } catch (error) {
      res.status(400).json({ errors: [{ message: error.message, extensions: error.extensions }] });
      return;
    }

    let document;
    try {
      document = parse(operation.query);
    } catch (error) {
      res.status(400).json({ errors: [{ message: error.message }] });
      return;
    }

    const validationErrors = validate(schema, document);
    if (validationErrors.length > 0) {
      res.status(400).json({ errors: validationErrors.map((error) => ({ message: error.message })) });
      return;
    }

    const operationType = getOperationAST(document, operation.operationName)?.operation;

    // GET requests may be prefetched or replayed, so they must stay side-effect free.
    if (req.method === 'GET' && operationType === 'mutation') {
      res.set('Allow', 'POST').status(405).json({
        errors: [
          { message: 'Mutations must be sent with POST.', extensions: { code: 'METHOD_NOT_ALLOWED' } },
        ],
      });
      return;
    }

    // Aborts in-flight subscriptions as soon as the client goes away.
    const controller = new AbortController();
    res.on('close', () => controller.abort());

    const context = {
      ...(typeof contextValue === 'function' ? await contextValue({ req }) : contextValue ?? {}),
      signal: controller.signal,
    };

    const args = {
      schema,
      document,
      variableValues: operation.variables,
      operationName: operation.operationName,
      contextValue: context,
    };

    const isSubscription = operationType === 'subscription';

    let result;
    try {
      result = await (isSubscription ? subscribe(args) : execute(args));
    } catch (error) {
      res.status(500).json({ errors: [{ message: error?.message ?? String(error) }] });
      return;
    }

    // Queries, mutations, and failed subscription setups produce a single
    // ExecutionResult instead of an async iterator.
    if (!result || typeof result[Symbol.asyncIterator] !== 'function') {
      res.writeHead(200, SSE_HEADERS);
      writeEvent(res, 'next', result);
      writeEvent(res, 'complete');
      res.end();
      return;
    }

    metrics?.increment?.('graphql_stream_subscriptions_total', { transport: 'sse' });
    res.writeHead(200, SSE_HEADERS);
    // Comment frame flushes headers and keeps proxies from idling the socket.
    res.write(': connected\n\n');

    const heartbeat = heartbeatMs > 0 ? setInterval(() => res.write(': ping\n\n'), heartbeatMs) : null;
    heartbeat?.unref?.();

    try {
      for await (const payload of result) {
        if (controller.signal.aborted) break;
        writeEvent(res, 'next', payload);
      }
      if (!controller.signal.aborted) writeEvent(res, 'complete');
    } catch (error) {
      logger?.error?.('graphql stream failed', { error: error?.message ?? String(error) });
      if (!controller.signal.aborted) {
        writeEvent(res, 'next', { errors: [{ message: 'Subscription failed.' }] });
        writeEvent(res, 'complete');
      }
    } finally {
      if (heartbeat) clearInterval(heartbeat);
      await result.return?.();
      res.end();
    }
  }

  router.get('/', handle);
  router.post('/', handle);

  return router;
}
