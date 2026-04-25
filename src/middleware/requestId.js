// Plan ref: M-8, L-7 — request correlation IDs.
//
// Mounted early in the middleware chain so that:
//   - every response carries an `X-Request-Id` header (echoed from inbound or
//     freshly generated) for client/server log correlation
//   - every downstream handler can use `req.log` (a pino child logger
//     pre-tagged with `reqId`) to emit structured, correlated log lines
//
// TODO(M-8 follow-up): once controllers/services are migrated off `console.*`
// to `req.log`, also enable a one-line access log here, e.g.:
//   req.log.info({ method: req.method, url: req.originalUrl }, "request");
// Skipped in this wave to keep the diff minimal and avoid log-volume surprises.

import crypto from "crypto";
import logger from "../utils/logger.js";

export function requestId(req, res, next) {
  const incoming = req.headers["x-request-id"];
  const id =
    typeof incoming === "string" && /^[A-Za-z0-9_-]{8,64}$/.test(incoming)
      ? incoming
      : crypto.randomUUID();
  req.requestId = id;
  res.setHeader("X-Request-Id", id);
  req.log = logger.child({ reqId: id });
  next();
}
