import { readFileSync } from 'node:fs';
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname } from 'node:path';

import { logger as defaultLogger } from '../observability/logger.js';

const require = createRequire(import.meta.url);

/** Default in-process cache: fastest option, lost on restart. */
export function createMemoryCacheStore() {
  const entries = new Map();

  return {
    kind: 'memory',
    get(key) {
      const hit = entries.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        entries.delete(key);
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttlMs) {
      entries.set(key, { value, expiresAt: Date.now() + ttlMs });
    },
    clear() {
      entries.clear();
    },
  };
}

/**
 * Optional persistent cache: entries are mirrored to a JSON file so a restarted
 * process can serve warm upstream data instead of re-fetching everything.
 * Values must be JSON-serialisable, which holds for all normalized finance
 * payloads.
 */
export function createFileCacheStore({ file, logger = defaultLogger } = {}) {
  if (!file) throw new Error('file cache store requires a file path');

  const memory = new Map();
  let writeChain = Promise.resolve();
  let writing = false;
  let dirty = false;

  function load() {
    try {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      for (const [key, entry] of Object.entries(parsed)) {
        if (entry && typeof entry.expiresAt === 'number' && entry.expiresAt > Date.now()) {
          memory.set(key, entry);
        }
      }
    } catch (error) {
      // A missing or corrupt cache file is never fatal: start cold instead.
      if (error?.code !== 'ENOENT') {
        logger.warn('persistent cache could not be read', { file, error: error?.message ?? String(error) });
      }
    }
  }

  function persist() {
    dirty = true;
    if (writing) return writeChain;

    writing = true;
    writeChain = (async () => {
      try {
        // Coalesce every update queued while a write is in flight into one pass.
        while (dirty) {
          dirty = false;
          const payload = JSON.stringify(Object.fromEntries(memory));
          await mkdir(dirname(file), { recursive: true });
          const temporaryFile = `${file}.${process.pid}.tmp`;
          await writeFile(temporaryFile, payload);
          await rename(temporaryFile, file);
        }
      } catch (error) {
        logger.warn('persistent cache could not be written', { file, error: error?.message ?? String(error) });
      } finally {
        writing = false;
      }
    })();

    return writeChain;
  }

  load();

  return {
    kind: 'file',
    file,
    get(key) {
      const hit = memory.get(key);
      if (!hit) return undefined;
      if (hit.expiresAt <= Date.now()) {
        memory.delete(key);
        persist();
        return undefined;
      }
      return hit.value;
    },
    set(key, value, ttlMs) {
      memory.set(key, { value, expiresAt: Date.now() + ttlMs });
      persist();
    },
    clear() {
      memory.clear();
      persist();
    },
    /** Resolves once every queued write has been flushed to disk. */
    flush() {
      return writeChain;
    },
  };
}

/** Selects a cache store from configuration (`memory` by default). */
export function createCacheStore({ store = 'memory', file, sharedModule, logger = defaultLogger } = {}) {
  if (store === 'file') return createFileCacheStore({ file, logger });
  if (store === 'shared') {
    if (sharedModule) {
      try {
        const loaded = require(sharedModule);
        const factory = loaded.createSharedCacheStore ?? loaded.default;
        if (typeof factory === 'function') {
          const sharedStore = factory({ logger });
          if (sharedStore && typeof sharedStore.get === 'function' && typeof sharedStore.set === 'function' && typeof sharedStore.clear === 'function') {
            return { kind: sharedStore.kind ?? 'shared', ...sharedStore };
          }
        }
        logger.warn('shared cache module is invalid, falling back to memory', { sharedModule });
      } catch (error) {
        logger.warn('shared cache module could not be loaded, falling back to memory', {
          sharedModule,
          error: error?.message ?? String(error),
        });
      }
    } else {
      logger.warn('shared cache store requested without module, falling back to memory');
    }
    return createMemoryCacheStore();
  }
  if (store !== 'memory') {
    logger.warn('unknown cache store, falling back to memory', { store });
  }
  return createMemoryCacheStore();
}
