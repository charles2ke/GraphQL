import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { describe, it } from 'node:test';

import cors from 'cors';
import express from 'express';

import { createStore } from '../src/data/store.js';
import { createSchema } from '../src/schema.js';
import { createFinanceService } from '../src/services/financeService.js';
import { createPubSub, TOPICS } from '../src/streaming/pubsub.js';
import { createStreamRouter } from '../src/streaming/sseRouter.js';

/** Starts the streaming endpoint on an ephemeral port and returns its base URL. */
async function startServer(routerOptions = {}) {
  const store = createStore();
  const pubsub = createPubSub();
  const app = express();

  app.use(
    '/graphql/stream',
    cors(),
    express.json(),
    createStreamRouter({
      schema: createSchema(),
      heartbeatMs: 0,
      contextValue: () => ({ store, finance: createFinanceService(), pubsub }),
      ...routerOptions,
    })
  );

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, resolve));
  const { port } = server.address();

  return {
    url: `http://127.0.0.1:${port}/graphql/stream`,
    store,
    pubsub,
    // Open SSE responses would keep server.close() waiting forever when an
    // assertion fails before the test aborts its subscriptions.
    close: () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  };
}

/** Parses an SSE byte stream into `{ event, data }` frames. */
async function* readEvents(response, controller) {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of response.body) {
    buffer += decoder.decode(chunk, { stream: true });

    let index;
    while ((index = buffer.indexOf('\n\n')) !== -1) {
      const frame = buffer.slice(0, index);
      buffer = buffer.slice(index + 2);
      if (frame.startsWith(':')) continue; // heartbeat/comment

      const event = /^event: (.*)$/m.exec(frame)?.[1];
      const data = /^data: (.*)$/m.exec(frame)?.[1];
      yield { event, data: data ? JSON.parse(data) : undefined };
      if (event === 'complete') {
        controller?.abort();
        return;
      }
    }
  }
}

describe('GraphQL streaming (SSE)', () => {
  it('streams subscription events as they are published', async () => {
    const app = await startServer();

    try {
      const controller = new AbortController();
      const response = await fetch(`${app.url}?query=${encodeURIComponent('subscription { userCreated { id name } }')}`, {
        signal: controller.signal,
      });

      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /text\/event-stream/);

      const events = readEvents(response, controller);
      // Give the subscription a tick to register before publishing.
      await new Promise((resolve) => setTimeout(resolve, 20));

      const user = app.store.createUser({ name: 'Grace Hopper', email: 'grace@example.com' });
      app.pubsub.publish(TOPICS.USER_CREATED, { userCreated: user });

      const first = await events.next();
      assert.equal(first.value.event, 'next');
      assert.equal(first.value.data.data.userCreated.name, 'Grace Hopper');

      controller.abort();
    } finally {
      await app.close();
    }
  });

  it('filters post events by author', async () => {
    const app = await startServer();

    try {
      const controller = new AbortController();
      const query = 'subscription { postCreated(authorId: "2") { id title author { name } } }';
      const response = await fetch(`${app.url}?query=${encodeURIComponent(query)}`, { signal: controller.signal });
      const events = readEvents(response, controller);
      await new Promise((resolve) => setTimeout(resolve, 20));

      app.pubsub.publish(TOPICS.POST_CREATED, { postCreated: app.store.createPost({ title: 'Ignored', content: 'x', authorId: '1' }) });
      app.pubsub.publish(TOPICS.POST_CREATED, { postCreated: app.store.createPost({ title: 'Kept', content: 'y', authorId: '2' }) });

      const first = await events.next();
      assert.equal(first.value.data.data.postCreated.title, 'Kept');
      assert.equal(first.value.data.data.postCreated.author.name, 'Alan Turing');

      controller.abort();
    } finally {
      await app.close();
    }
  });

  it('streams update and delete events published by mutations', async () => {
    const app = await startServer();

    /** Opens an SSE subscription and returns its frame iterator. */
    async function open(query) {
      const controller = new AbortController();
      const response = await fetch(`${app.url}?query=${encodeURIComponent(query)}`, { signal: controller.signal });
      return { controller, events: readEvents(response, controller) };
    }

    /** Runs a one-shot mutation through the same endpoint and returns its result. */
    async function mutate(query) {
      const response = await fetch(app.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query }),
      });
      const frames = [];
      for await (const frame of readEvents(response)) frames.push(frame);
      return frames[0].data;
    }

    try {
      const updates = await open('subscription { userUpdated { id name } }');
      const deletions = await open('subscription { postDeleted(authorId: "2") { id title author { name } } }');
      await new Promise((resolve) => setTimeout(resolve, 20));

      await mutate('mutation { updateUser(id: "2", name: "Alan M. Turing") { id } }');
      // Post 1 belongs to author 1, so only the second deletion matches the filter.
      await mutate('mutation { deletePost(id: "1") { id } }');
      // The author is deleted too before the event is delivered; the event must
      // still resolve its non-null author as it was when the post was deleted.
      const deleted = await mutate('mutation { deletePost(id: "2") { id } deleteUser(id: "2") { id } }');
      assert.equal(deleted.errors, undefined);

      const updated = await updates.events.next();
      assert.deepEqual(updated.value.data.data.userUpdated, { id: '2', name: 'Alan M. Turing' });

      const removed = await deletions.events.next();
      assert.deepEqual(removed.value.data.data.postDeleted, {
        id: '2',
        title: 'On computable numbers',
        author: { name: 'Alan M. Turing' },
      });

      updates.controller.abort();
      deletions.controller.abort();
    } finally {
      await app.close();
    }
  });

  it('streams a single result for queries and mutations', async () => {
    const app = await startServer();

    try {
      const response = await fetch(app.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ query: '{ users { name } }' }),
      });

      assert.equal(response.status, 200);
      const frames = [];
      for await (const frame of readEvents(response)) frames.push(frame);

      assert.deepEqual(frames.map((frame) => frame.event), ['next', 'complete']);
      assert.equal(frames[0].data.data.users.length, 2);

      const mutation = await fetch(app.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          query: 'mutation { createUser(name: "Grace Hopper", email: "grace@example.com") { id name } }',
        }),
      });

      assert.equal(mutation.status, 200);
      const mutationFrames = [];
      for await (const frame of readEvents(mutation)) mutationFrames.push(frame);

      assert.deepEqual(mutationFrames.map((frame) => frame.event), ['next', 'complete']);
      assert.equal(mutationFrames[0].data.data.createUser.name, 'Grace Hopper');
      assert.equal(app.store.getUser(mutationFrames[0].data.data.createUser.id)?.name, 'Grace Hopper');
    } finally {
      await app.close();
    }
  });

  it('rejects malformed and invalid operations with 400', async () => {
    const app = await startServer();

    try {
      const missing = await fetch(app.url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      assert.equal(missing.status, 400);

      const syntax = await fetch(`${app.url}?query=${encodeURIComponent('{ users')}`);
      assert.equal(syntax.status, 400);

      const invalid = await fetch(`${app.url}?query=${encodeURIComponent('subscription { nope }')}`);
      assert.equal(invalid.status, 400);
      const body = await invalid.json();
      assert.ok(body.errors[0].message.includes('nope'));
    } finally {
      await app.close();
    }
  });

  it('answers 503 to new operations once shutdown has started', async () => {
    const app = await startServer({ shutdownSignal: AbortSignal.abort() });

    try {
      const response = await fetch(`${app.url}?query=${encodeURIComponent('{ __typename }')}`);
      assert.equal(response.status, 503);
      assert.equal((await response.json()).errors[0].extensions.code, 'SERVICE_UNAVAILABLE');
    } finally {
      await app.close();
    }
  });
});

describe('pub/sub', () => {
  it('delivers buffered payloads and stops on abort', async () => {
    const pubsub = createPubSub();
    const controller = new AbortController();
    const iterator = pubsub.subscribe('topic', { signal: controller.signal });

    pubsub.publish('topic', 1);
    pubsub.publish('topic', 2);

    assert.deepEqual(await iterator.next(), { value: 1, done: false });
    assert.deepEqual(await iterator.next(), { value: 2, done: false });

    const pending = iterator.next();
    controller.abort();
    assert.deepEqual(await pending, { value: undefined, done: true });
    assert.deepEqual(await iterator.next(), { value: undefined, done: true });
  });

  it('drops the oldest events once the queue is full', async () => {
    const pubsub = createPubSub({ maxQueueSize: 2 });
    const iterator = pubsub.subscribe('topic');

    pubsub.publish('topic', 'a');
    pubsub.publish('topic', 'b');
    pubsub.publish('topic', 'c');

    assert.equal((await iterator.next()).value, 'b');
    assert.equal((await iterator.next()).value, 'c');
    await iterator.return();
  });

  it('stops delivering after unsubscribe', async () => {
    const pubsub = createPubSub();
    const iterator = pubsub.subscribe('topic');

    pubsub.publish('topic', 'buffered');
    await iterator.return();
    pubsub.publish('topic', 'ignored');

    assert.deepEqual(await iterator.next(), { value: undefined, done: true });
  });
});
