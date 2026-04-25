import bcrypt from "bcryptjs";

/**
 * Shared password policy / login-hardening primitives.
 *
 * Extracted from controllers/common/authController.js so the admin login flow
 * (controllers/admin/adminAuthController.js) can apply the same protections
 * without duplicating constants. The customer authController and the admin
 * authController are the only intended consumers — keep this module
 * dependency-light (only bcryptjs) so it can be imported from anywhere in the
 * controller layer without creating cycles.
 */

// ========== H-2: password strength policy ==========
export const COMMON_PASSWORDS = new Set([
  "Password123!",
  "Password1234!",
  "Welcome123!",
  "Welcome1234!",
  "Qwerty12345!",
  "Qwerty123456!",
  "Letmein123!",
  "Admin1234!",
  "Administrator1!",
  "Changeme123!",
  "Passw0rd!23",
  "P@ssw0rd123",
  "P@ssword1234",
  "Iloveyou123!",
  "Sunshine123!",
  "Football123!",
  "Baseball123!",
  "Trustno1!23",
  "Master1234!",
  "Dragon1234!",
  "Monkey1234!",
  "Abcdef1234!",
  "Abc123456789",
  "Summer2024!",
  "Summer2025!",
  "Winter2024!",
  "Winter2025!",
  "Spring2024!",
  "Autumn2024!",
  "Company123!",
  "Default1234!",
]);

/**
 * H-2: validate password strength.
 * Requires length >= 12, at least one lowercase, uppercase, digit; rejects
 * common passwords. Returns { ok, reason }.
 */
export function validatePasswordStrength(pw) {
  if (typeof pw !== "string") {
    return { ok: false, reason: "Password is required" };
  }
  if (pw.length < 12) {
    return { ok: false, reason: "Password must be at least 12 characters" };
  }
  if (!/[a-z]/.test(pw)) {
    return {
      ok: false,
      reason: "Password must contain at least one lowercase letter",
    };
  }
  if (!/[A-Z]/.test(pw)) {
    return {
      ok: false,
      reason: "Password must contain at least one uppercase letter",
    };
  }
  if (!/[0-9]/.test(pw)) {
    return { ok: false, reason: "Password must contain at least one digit" };
  }
  if (COMMON_PASSWORDS.has(pw)) {
    return {
      ok: false,
      reason: "This password is too common. Please choose a stronger one",
    };
  }
  return { ok: true, reason: "" };
}

// M-3: pre-computed bcrypt hash used to keep login timing constant on the
// "user-not-found" branch. Computed once at module load.
export const DUMMY_BCRYPT_HASH = bcrypt.hashSync("dummy-password-for-timing", 10);

// H-5: lockout config — shared between customer and admin login flows.
export const MAX_FAILED_LOGINS = 5;
export const LOCKOUT_DURATION_MS = 15 * 60 * 1000; // 15 minutes
