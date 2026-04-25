import crypto from "crypto";

/**
 * CSRF protection — double-submit cookie pattern (audit finding M-6).
 *
 * Scope: admin mutating endpoints only. The customer flow relies on
 * SameSite=lax/strict cookies (Wave 1B) and has lower blast radius; CSRF
 * for the customer surface is a follow-up wave.
 *
 * How it works:
 *   1. On admin login (and via GET /api/admin/auth/csrf) the backend issues
 *      a non-httpOnly cookie `ad-csrf` containing a 192-bit random token.
 *   2. The admin frontend reads that cookie via document.cookie and echoes
 *      its value as the `X-CSRF-Token` header on every mutating request.
 *   3. `requireCsrf` (mounted after `authenticateAdmin`) verifies that
 *      `req.cookies["ad-csrf"] === req.headers["x-csrf-token"]` for any
 *      non-safe HTTP method. A cross-origin attacker cannot read the cookie
 *      (it is not exposed cross-origin) and therefore cannot forge the
 *      matching header even if the auth cookie is somehow attached to the
 *      forged request.
 *
 * Why a non-httpOnly cookie is acceptable here: the CSRF token's only job
 * is to be re-echoed by trusted same-origin JS. It is not a session
 * credential, so XSS that can read the cookie can already act on behalf of
 * the user via the existing httpOnly auth cookie — there is no additional
 * risk surface. The cookie is SameSite=strict to keep it from being
 * attached on cross-site navigations at all.
 */

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const COOKIE_NAME = "ad-csrf";
const HEADER_NAME = "x-csrf-token";

/** Generate a 192-bit (24-byte) random hex token. */
export function generateCsrfToken() {
  return crypto.randomBytes(24).toString("hex");
}

/**
 * Set the CSRF cookie. Note: NOT httpOnly — admin frontend JS must be able
 * to read this value to populate the `X-CSRF-Token` header on mutations.
 */
export function setCsrfCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 7 * 24 * 60 * 60 * 1000, // matches ad-token JWT lifetime (7d)
    path: "/",
  });
}

/** Clear the CSRF cookie (call on logout alongside the auth cookie). */
export function clearCsrfCookie(res) {
  res.clearCookie(COOKIE_NAME, { path: "/" });
}

/**
 * Express middleware: enforce double-submit CSRF token on non-safe methods.
 * Mount AFTER `authenticateAdmin` (and after any role check) so that 401
 * still takes precedence over 403 for unauthenticated requests.
 */
export function requireCsrf(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  const cookieToken = req.cookies?.[COOKIE_NAME];
  const headerToken = req.headers[HEADER_NAME];
  if (!cookieToken || !headerToken || cookieToken !== headerToken) {
    return res.status(403).json({
      success: false,
      message: "CSRF token missing or invalid",
    });
  }
  next();
}

/**
 * Endpoint helper: issue or refresh a CSRF token. Wired at
 * GET /api/admin/auth/csrf so a stale session whose cookie expired or was
 * cleared can recover without forcing a full re-login.
 *
 * The token is returned in both the Set-Cookie response header and the
 * JSON body for redundancy — the frontend prefers the cookie path but
 * the body value is useful for non-browser callers (Postman, scripts).
 */
export function issueCsrfHandler(req, res) {
  const token = generateCsrfToken();
  setCsrfCookie(res, token);
  res.json({
    success: true,
    data: { csrfToken: token },
  });
}

export const CSRF_COOKIE_NAME = COOKIE_NAME;
export const CSRF_HEADER_NAME = HEADER_NAME;
