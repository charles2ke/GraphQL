import { randomUUID } from 'node:crypto';

export const REQUEST_ID_HEADER = 'x-request-id';

// Caller-supplied ids end up in logs and response headers, so only a
// conservative character set and length are accepted.
const SAFE_REQUEST_ID = /^[\w.:-]{1,128}$/;

/** Reuses a well-formed incoming id (e.g. set by a gateway) or generates one. */
export function resolveRequestId(incoming) {
  return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming) ? incoming : randomUUID();
}

/** Express middleware setting `req.requestId` and echoing it as `X-Request-Id`. */
export function requestIdMiddleware() {
  return (req, res, next) => {
    req.requestId = resolveRequestId(req.get(REQUEST_ID_HEADER));
    res.set(REQUEST_ID_HEADER, req.requestId);
    next();
  };
}
