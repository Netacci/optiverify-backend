import jwt from "jsonwebtoken";
import User from "../models/common/User.js";

// ========== C-2: fail-closed secret resolution ==========
const KNOWN_DEFAULTS = new Set([
  "your-jwt-secret-key-change-in-production",
  "your-secret-key-change-in-production",
  "change-me",
  "secret",
  "jwt-secret",
]);

function requireSecret(name) {
  const v = process.env[name];
  if (!v || v.length < 32 || KNOWN_DEFAULTS.has(v)) {
    if (process.env.NODE_ENV === "production") {
      throw new Error(
        `[SECURITY] ${name} must be set to a strong (>=32 char) non-default secret in production`
      );
    }
    console.warn(
      `⚠️  [SECURITY] ${name} is missing/weak/default — failing closed in non-production mode is OFF, but DEPLOY WILL FAIL. Set ${name} to a strong random value.`
    );
    return v || `dev-only-insecure-${name}-${Date.now()}`;
  }
  return v;
}

const JWT_SECRET = requireSecret("JWT_SECRET");

/**
 * Verify JWT token from cookie
 */
export const authenticate = async (req, res, next) => {
  try {
    // Get token from cookie (customer token)
    const token =
      req.cookies?.["cd-token"] ||
      req.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if this is an admin token (has adminId instead of userId)
    if (decoded.adminId) {
      return res.status(403).json({
        success: false,
        message:
          "Admin tokens cannot access user routes. Please log in as a user.",
      });
    }

    // Check if userId exists
    if (!decoded.userId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }

    // Find user
    const user = await User.findById(decoded.userId).select("-password");
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "User not found",
      });
    }

    // H-4: Token revocation via tokenVersion
    // If the token's version doesn't match the current user version, it has been revoked
    // (e.g. via logout, password reset, or password creation).
    const tokenV = typeof decoded.v === "number" ? decoded.v : 0;
    const userV = typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
    if (tokenV !== userV) {
      return res.status(401).json({
        success: false,
        message: "Token revoked",
      });
    }

    // Attach user to request
    req.user = user;
    next();
  } catch (error) {
    if (error.name === "JsonWebTokenError") {
      return res.status(401).json({
        success: false,
        message: "Invalid token",
      });
    }
    if (error.name === "TokenExpiredError") {
      return res.status(401).json({
        success: false,
        message: "Token expired",
      });
    }
    return res.status(500).json({
      success: false,
      message: "Authentication error",
    });
  }
};

/**
 * Generate JWT token
 *
 * H-4: accepts the full user object so the current `tokenVersion` is embedded
 * in the signed payload. This enables server-side revocation.
 *
 * Backwards-compatibility: legacy callers may still pass a string userId.
 * In that case we sign with v=0 (matches the schema default) so existing
 * accounts keep working until the next logout/password change bumps the
 * version.
 */
export const generateToken = (userOrId) => {
  let userId;
  let v = 0;
  if (userOrId && typeof userOrId === "object") {
    userId = userOrId._id ? userOrId._id.toString() : String(userOrId);
    v = typeof userOrId.tokenVersion === "number" ? userOrId.tokenVersion : 0;
  } else {
    userId = String(userOrId);
  }
  // H-4: reduced lifetime from 30d → 7d
  return jwt.sign({ userId, v }, JWT_SECRET, {
    expiresIn: "7d",
  });
};

/**
 * Optional authentication - doesn't fail if no token
 */
export const optionalAuth = async (req, res, next) => {
  try {
    // Get token from cookie (customer token) or Authorization header
    const token =
      req.cookies?.["cd-token"] ||
      req.headers?.authorization?.replace("Bearer ", "");

    if (token) {
      try {
        const decoded = jwt.verify(token, JWT_SECRET);
        // Only set user if it's a user token (not admin token)
        if (decoded.userId && !decoded.adminId) {
          const user = await User.findById(decoded.userId).select("-password");
          if (user) {
            // H-4: enforce tokenVersion match in optionalAuth too
            const tokenV = typeof decoded.v === "number" ? decoded.v : 0;
            const userV =
              typeof user.tokenVersion === "number" ? user.tokenVersion : 0;
            if (tokenV === userV) {
              req.user = user;
            }
          }
        }
      } catch (error) {
        // Continue without user if token is invalid
      }
    }
    next();
  } catch (error) {
    // Continue without user if token is invalid
    next();
  }
};
