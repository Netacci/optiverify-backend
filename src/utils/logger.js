// Migration plan (M-8, follow-up wave):
//   - Replace `console.log/error/warn` in services/controllers with `req.log` (request-scoped) or `logger` (module-scoped).
//   - Pino redact paths above will scrub fields named password/token/auth/cookie automatically.
//   - Use `logger.info({ event:"name", ...meta }, "human message")` shape.
//
// Operational notes:
//   - In production (NODE_ENV=production) the logger emits newline-delimited
//     JSON to stdout. The downstream log aggregator (e.g. CloudWatch, Datadog,
//     Loki) MUST be configured to parse JSON; otherwise the records will be
//     stored as opaque strings and PII redaction will still apply but
//     structured queries will not work.
//   - In development we attempt to load `pino-pretty` for human-readable
//     output. If it is not installed, pino silently falls back to JSON — that
//     is acceptable, just less readable.

import pino from "pino";

const isProd = process.env.NODE_ENV === "production";

const REDACT_PATHS = [
  "password",
  "newPassword",
  "oldPassword",
  "currentPassword",
  "token",
  "jwt",
  "authorization",
  "cookie",
  "*.password",
  "*.token",
  "*.authorization",
  "*.cookie",
  "req.headers.authorization",
  "req.headers.cookie",
  "res.headers['set-cookie']",
  "*.creditCard",
  "*.ssn",
  "*.cardNumber",
];

const logger = pino({
  level: process.env.LOG_LEVEL || (isProd ? "info" : "debug"),
  redact: { paths: REDACT_PATHS, remove: true },
  timestamp: pino.stdTimeFunctions.isoTime,
  base: { service: "supplyai-backend" },
  ...(isProd
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true, translateTime: "HH:MM:ss.l" },
        },
      }),
});

export default logger;
export { logger };

// Convenience wrappers that swallow well-known PII fields if a controller passes them in by mistake.
export function logSafe(level, msg, meta = {}) {
  const cleaned = { ...meta };
  for (const k of ["password", "token", "jwt", "authorization", "cookie"]) {
    if (k in cleaned) cleaned[k] = "[redacted]";
  }
  logger[level](cleaned, msg);
}
