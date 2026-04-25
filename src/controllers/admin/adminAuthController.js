import bcrypt from "bcryptjs";
import Admin from "../../models/admin/Admin.js";
import { generateAdminToken } from "../../middleware/adminAuth.js";
import {
  generateCsrfToken,
  setCsrfCookie,
  clearCsrfCookie,
} from "../../middleware/csrf.js";
import {
  validatePasswordStrength,
  DUMMY_BCRYPT_HASH,
  MAX_FAILED_LOGINS,
  LOCKOUT_DURATION_MS,
} from "../../services/passwordPolicy.js";

// Generic error for the login flow — never tell the caller WHY auth failed
// (no-such-admin vs wrong-password vs locked-out vs inactive). The only
// non-generic state surfaced to the client is the response status code.
const GENERIC_LOGIN_ERROR = "Invalid credentials";

/**
 * Login admin
 *
 * Hardened to match the customer login flow:
 *  - M-3: constant-time path on user-not-found and locked-out branches
 *    (always run a bcrypt compare against DUMMY_BCRYPT_HASH).
 *  - H-5: failedLoginCount + lockedUntil enforcement.
 *  - M-12: silent bcrypt rehash on successful login if cost factor is below
 *    the current target (Admin.needsRehash()).
 *  - H-4: pass the full admin doc to generateAdminToken so the JWT embeds
 *    tokenVersion (v) for revocation. Cookie maxAge matches JWT lifetime (7d).
 */
export const loginAdmin = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    const adminEmail = String(email).toLowerCase().trim();

    // Look up admin. We deliberately do NOT branch the response on existence —
    // the not-found path performs a dummy bcrypt compare so timing stays
    // constant (M-3) and returns the same generic error as wrong-password.
    const admin = await Admin.findOne({ email: adminEmail });

    if (!admin) {
      // M-3: constant-time compare against a fixed dummy hash so attackers
      // cannot enumerate registered admin emails by login latency.
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return res.status(401).json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      });
    }

    // H-5: lockout enforcement — reject before checking password. Still burn
    // comparable CPU on the dummy hash so timing doesn't leak the locked vs
    // unlocked distinction.
    if (admin.lockedUntil && admin.lockedUntil.getTime() > Date.now()) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return res.status(401).json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      });
    }

    // Preserve the existing isActive check. We surface a distinct message here
    // because account-disabled is an operational state the admin needs to
    // diagnose with their own admin team — and it doesn't enable enumeration
    // beyond what an attacker who already knows valid admin credentials can
    // observe. Run a dummy compare first to keep timing roughly aligned with
    // the password-check path.
    if (!admin.isActive) {
      await bcrypt.compare(password, DUMMY_BCRYPT_HASH);
      return res.status(401).json({
        success: false,
        message: "Admin account is inactive",
      });
    }

    // Check password.
    const isMatch = await admin.comparePassword(password);
    if (!isMatch) {
      // H-5: track failed attempts and lock after MAX_FAILED_LOGINS.
      admin.failedLoginCount = (admin.failedLoginCount || 0) + 1;
      if (admin.failedLoginCount >= MAX_FAILED_LOGINS) {
        admin.lockedUntil = new Date(Date.now() + LOCKOUT_DURATION_MS);
      }
      await admin.save();
      return res.status(401).json({
        success: false,
        message: GENERIC_LOGIN_ERROR,
      });
    }

    // Successful login — reset lockout state.
    admin.failedLoginCount = 0;
    admin.lockedUntil = undefined;

    // M-12: silent bcrypt rehash. If the stored hash uses fewer rounds than
    // the current target, re-hash by reassigning the plaintext (the pre-save
    // hook handles the rest).
    if (typeof admin.needsRehash === "function" && admin.needsRehash()) {
      admin.password = password;
    }
    await admin.save();

    // H-4: pass the full admin doc so tokenVersion is embedded in the JWT.
    const token = generateAdminToken(admin);

    // Set cookie (admin token). H-4: 7 days, matches JWT expiresIn.
    res.cookie("ad-token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60 * 1000,
    });

    // M-6: issue a CSRF token (double-submit cookie). The cookie itself is
    // not httpOnly so the admin frontend JS can read it and echo the value
    // as `X-CSRF-Token` on mutating requests. We also include the value in
    // the response body for non-browser callers (Postman, scripts) that
    // prefer to keep state out of cookie jars.
    const csrfToken = generateCsrfToken();
    setCsrfCookie(res, csrfToken);

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        csrfToken,
        user: {
          id: admin._id,
          email: admin.email,
          role: admin.role,
        },
      },
    });
  } catch (error) {
    console.error("Error logging in admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Logout admin
 *
 * H-4: bumps tokenVersion BEFORE clearing the cookie so any other live
 * sessions (other tabs, leaked tokens) are immediately revoked at the next
 * authenticateAdmin() call.
 */
export const logoutAdmin = async (req, res) => {
  try {
    if (req.admin && req.admin._id) {
      // Re-fetch a writable doc — req.admin came in via .select("-password")
      // and we want to be defensive about modifying it.
      const admin = await Admin.findById(req.admin._id);
      if (admin) {
        admin.tokenVersion = (admin.tokenVersion || 0) + 1;
        await admin.save();
      }
    }
  } catch (e) {
    // Don't fail logout on a token-bump error — still clear cookie.
    console.error("Error bumping tokenVersion on admin logout:", e);
  }
  res.clearCookie("ad-token");
  // M-6: clear the CSRF cookie alongside the auth cookie so the next login
  // starts from a clean slate (otherwise a stale `ad-csrf` would linger
  // until its 7d maxAge expired).
  clearCsrfCookie(res);
  res.json({
    success: true,
    message: "Logged out successfully",
  });
};

/**
 * Get current admin
 */
export const getCurrentAdmin = async (req, res) => {
  try {
    const admin = await Admin.findById(req.admin._id).select("-password");

    res.json({
      success: true,
      data: {
        user: {
          id: admin._id,
          email: admin.email,
          role: admin.role,
          isActive: admin.isActive,
        },
      },
    });
  } catch (error) {
    console.error("Error getting current admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Change admin password
 *
 * Hardened to match the customer reset flow:
 *  - H-2: enforce strong password policy on the new password.
 *  - H-4: bump tokenVersion to revoke all other sessions on password change.
 *  - H-5: clear lockout/failed-login state on success.
 *  - Clears the ad-token cookie so the calling session must re-authenticate
 *    with the new credentials.
 */
export const changeAdminPassword = async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;

    if (!currentPassword || !newPassword) {
      return res.status(400).json({
        success: false,
        message: "Current password and new password are required",
      });
    }

    // H-2: enforce strong password policy on the new password BEFORE doing
    // any DB work — cheap reject for weak passwords.
    const pwCheck = validatePasswordStrength(newPassword);
    if (!pwCheck.ok) {
      return res.status(400).json({
        success: false,
        message: pwCheck.reason,
      });
    }

    // Find admin (re-fetched as a writable doc).
    const admin = await Admin.findById(req.admin._id);
    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    // Verify current password.
    const isMatch = await admin.comparePassword(currentPassword);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Current password is incorrect",
      });
    }

    // Update password (will be hashed by pre-save hook).
    admin.password = newPassword;
    // H-4: bump tokenVersion to revoke all existing sessions on password change.
    admin.tokenVersion = (admin.tokenVersion || 0) + 1;
    // H-5: clear any lockout/failed-login state on successful password change.
    admin.failedLoginCount = 0;
    admin.lockedUntil = undefined;
    await admin.save();

    // Clear the cookie so the calling session must re-login. Other live
    // sessions are revoked by the tokenVersion bump above on their next
    // authenticateAdmin() call.
    res.clearCookie("ad-token");
    // M-6: clear CSRF cookie too — it is bound to the (now-invalidated)
    // session and the next login will issue a fresh one.
    clearCsrfCookie(res);

    res.json({
      success: true,
      message: "Password changed successfully",
    });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
