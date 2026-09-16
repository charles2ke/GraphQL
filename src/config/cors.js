/**
 * Environment-driven CORS configuration.
 *
 * `CORS_ALLOWED_ORIGINS` holds a comma-separated allow-list of origins that may
 * read responses cross-origin (e.g. `https://app.example.com,https://admin.example.com`).
 * Anything outside the list gets no `Access-Control-Allow-Origin` header, so the
 * browser blocks the response; the wildcard `*` is never emitted.
 */
export function parseAllowedOrigins(value) {
  return String(value ?? '')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

/** Builds the options object passed to the `cors()` middleware. */
export function loadCorsOptions(env = process.env) {
  const allowedOrigins = parseAllowedOrigins(env.CORS_ALLOWED_ORIGINS);

  return {
    // Requests without an `Origin` header (curl, server-to-server, same-origin
    // navigations) are not subject to CORS, so they pass through unchanged and
    // simply receive no CORS headers.
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, origin ? [origin] : false);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  };
}
