import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { logger as defaultLogger } from '../observability/logger.js';

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
    try {
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, JSON.stringify(Object.fromEntries(memory)));
    } catch (error) {
      logger.warn('persistent cache could not be written', { file, error: error?.message ?? String(error) });
    }
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
  };
}

/** Selects a cache store from configuration (`memory` by default). */
export function createCacheStore({ store = 'memory', file, logger = defaultLogger } = {}) {
  if (store === 'file') return createFileCacheStore({ file, logger });
  if (store !== 'memory') {
    logger.warn('unknown cache store, falling back to memory', { store });
  }
  return createMemoryCacheStore();
}
