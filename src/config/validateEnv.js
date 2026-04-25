// Fail-closed startup secret validator.
// Called from server.js BEFORE the app starts (and before any module that
// reads these vars at import time would observe a missing/insecure value).
//
// In production: throws if any required secret is missing, set to a known
//   insecure default, or (for signing keys) shorter than 32 chars.
// In non-production: warns only, so local dev still boots without ceremony.
//
// Plan reference: C-2, C-6 follow-up, H-6.

const REQUIRED = [
  "MONGO_URL",
  "JWT_SECRET",
  "TOKEN_SECRET",
  "COOKIE_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "OPENAI_API_KEY",
];

const KNOWN_DEFAULTS = new Set([
  "your-jwt-secret-key-change-in-production",
  "your-secret-key-change-in-production",
  "whsec_dummy_secret",
  "change-me",
  "secret",
]);

const MIN_LEN_SIGNING_KEYS = new Set([
  "JWT_SECRET",
  "TOKEN_SECRET",
  "COOKIE_SECRET",
]);

export function validateEnv() {
  const isProd = process.env.NODE_ENV === "production";
  const errors = [];

  for (const name of REQUIRED) {
    const v = process.env[name];
    if (!v) {
      errors.push(`${name} is missing`);
    } else if (KNOWN_DEFAULTS.has(v)) {
      errors.push(`${name} is set to a known insecure default`);
    } else if (MIN_LEN_SIGNING_KEYS.has(name) && v.length < 32) {
      errors.push(`${name} must be >= 32 chars`);
    }
  }

  if (errors.length) {
    const msg = `[startup] Insecure configuration:\n  - ${errors.join("\n  - ")}`;
    if (isProd) {
      console.error(msg);
      throw new Error("Refusing to start with insecure configuration");
    } else {
      console.warn(`${msg}\n  (warning only — NODE_ENV != production)`);
    }
  }
}
