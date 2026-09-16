/**
 * Minimal in-process publish/subscribe used by GraphQL subscriptions.
 *
 * Keeping it in memory matches the rest of the demo service (no broker
 * required). Swap this module for a Redis/NATS backed implementation to run
 * more than one instance: subscribers only depend on the async-iterator
 * contract returned by `subscribe`.
 */

const DEFAULT_MAX_QUEUE = 100;

export function createPubSub({ maxQueueSize = DEFAULT_MAX_QUEUE } = {}) {
  /** @type {Map<string, Set<(payload: unknown) => void>>} */
  const topics = new Map();

  function publish(topic, payload) {
    const listeners = topics.get(topic);
    if (!listeners) return;
    for (const listener of [...listeners]) listener(payload);
  }

  /**
   * Returns an async iterator yielding every payload published to `topic`
   * after the call. The iterator stops when `signal` aborts or when the
   * consumer calls `return()` (which `for await ... of` does on break).
   */
  function subscribe(topic, { signal } = {}) {
    const queue = [];
    /** @type {((result: IteratorResult<unknown>) => void) | null} */
    let pending = null;
    let done = false;

    const listener = (payload) => {
      if (done) return;
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value: payload, done: false });
        return;
      }
      // Drop the oldest event rather than growing without bound when a
      // consumer is slower than the publisher.
      if (queue.length >= maxQueueSize) queue.shift();
      queue.push(payload);
    };

    const listeners = topics.get(topic) ?? new Set();
    listeners.add(listener);
    topics.set(topic, listeners);

    function stop() {
      if (done) return { value: undefined, done: true };
      done = true;
      listeners.delete(listener);
      if (listeners.size === 0) topics.delete(topic);
      signal?.removeEventListener?.('abort', stop);
      if (pending) {
        const resolve = pending;
        pending = null;
        resolve({ value: undefined, done: true });
      }
      return { value: undefined, done: true };
    }

    if (signal) {
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    }

    return {
      [Symbol.asyncIterator]() {
        return this;
      },
      next() {
        if (queue.length > 0) return Promise.resolve({ value: queue.shift(), done: false });
        if (done) return Promise.resolve({ value: undefined, done: true });
        return new Promise((resolve) => {
          pending = resolve;
        });
      },
      return() {
        return Promise.resolve(stop());
      },
      throw(error) {
        stop();
        return Promise.reject(error);
      },
    };
  }

  return { publish, subscribe };
}

/** Topics published by the demo resolvers. */
export const TOPICS = {
  USER_CREATED: 'USER_CREATED',
  POST_CREATED: 'POST_CREATED',
};

/** Default pub/sub instance shared by the running server. */
export const pubsub = createPubSub();
