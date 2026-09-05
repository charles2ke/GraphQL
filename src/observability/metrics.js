/** Serializes label objects into a stable Prometheus-style label key. */
function labelKey(labels = {}) {
  const entries = Object.entries(labels)
    .filter(([, value]) => value !== undefined && value !== null)
    .sort(([a], [b]) => a.localeCompare(b));

  return entries.map(([key, value]) => `${key}="${String(value).replace(/["\\\n]/g, '_')}"`).join(',');
}

/**
 * In-process metrics registry with counters and latency summaries.
 * It is intentionally tiny: no dependency is required and the snapshot can be
 * rendered as Prometheus text or consumed as JSON by a health endpoint.
 */
export function createMetrics() {
  const counters = new Map();
  const durations = new Map();

  function increment(name, labels = {}, value = 1) {
    const key = `${name}|${labelKey(labels)}`;
    const current = counters.get(key) ?? { name, labels, value: 0 };
    current.value += value;
    counters.set(key, current);
  }

  function observe(name, milliseconds, labels = {}) {
    const key = `${name}|${labelKey(labels)}`;
    const current = durations.get(key) ?? { name, labels, count: 0, totalMs: 0, maxMs: 0 };
    current.count += 1;
    current.totalMs += milliseconds;
    current.maxMs = Math.max(current.maxMs, milliseconds);
    durations.set(key, current);
  }

  /** Times an async task and records success/failure counters plus latency. */
  async function time(name, labels, task) {
    const startedAt = Date.now();
    try {
      const result = await task();
      observe(`${name}_duration_ms`, Date.now() - startedAt, { ...labels, outcome: 'success' });
      increment(`${name}_total`, { ...labels, outcome: 'success' });
      return result;
    } catch (error) {
      observe(`${name}_duration_ms`, Date.now() - startedAt, { ...labels, outcome: 'failure' });
      increment(`${name}_total`, { ...labels, outcome: 'failure' });
      throw error;
    }
  }

  function snapshot() {
    return {
      counters: [...counters.values()].map((counter) => ({ ...counter })),
      durations: [...durations.values()].map((duration) => ({
        ...duration,
        avgMs: duration.count === 0 ? 0 : Number((duration.totalMs / duration.count).toFixed(3)),
      })),
    };
  }

  function toPrometheus() {
    const current = snapshot();
    const lines = [];

    for (const counter of current.counters) {
      const labels = labelKey(counter.labels);
      lines.push(`${counter.name}${labels ? `{${labels}}` : ''} ${counter.value}`);
    }

    for (const duration of current.durations) {
      const labels = labelKey(duration.labels);
      const suffix = labels ? `{${labels}}` : '';
      lines.push(`${duration.name}_count${suffix} ${duration.count}`);
      lines.push(`${duration.name}_sum${suffix} ${duration.totalMs}`);
      lines.push(`${duration.name}_max${suffix} ${duration.maxMs}`);
    }

    return `${lines.join('\n')}\n`;
  }

  function reset() {
    counters.clear();
    durations.clear();
  }

  return { increment, observe, time, snapshot, toPrometheus, reset };
}

export const metrics = createMetrics();
