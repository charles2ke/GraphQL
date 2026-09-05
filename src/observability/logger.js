const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };

const REDACTED_KEYS = ['apikey', 'authorization', 'password', 'secret', 'token'];

/** Strips credential-like values so logs never leak connector secrets. */
function redact(fields) {
  return Object.fromEntries(
    Object.entries(fields).map(([key, value]) => [
      key,
      REDACTED_KEYS.includes(key.toLowerCase()) ? '[redacted]' : value,
    ])
  );
}

/**
 * Minimal structured (JSON lines) logger. Keeping it dependency-free makes the
 * output easy to ship to any log aggregator without extra libraries.
 */
export function createLogger({ level = process.env.LOG_LEVEL ?? 'info', write = console.log, name = 'graphql-demo-service' } = {}) {
  const threshold = LEVELS[level] ?? LEVELS.info;

  function log(logLevel, message, fields = {}) {
    if (LEVELS[logLevel] < threshold) return;
    write(
      JSON.stringify({
        level: logLevel,
        time: new Date().toISOString(),
        service: name,
        message,
        ...redact(fields),
      })
    );
  }

  return {
    level,
    debug: (message, fields) => log('debug', message, fields),
    info: (message, fields) => log('info', message, fields),
    warn: (message, fields) => log('warn', message, fields),
    error: (message, fields) => log('error', message, fields),
  };
}

export const logger = createLogger();
