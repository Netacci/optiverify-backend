import jwt from "jsonwebtoken";
import Admin from "../models/admin/Admin.js";

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
 * Verify JWT token from cookie for admin
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    // Get token from cookie (admin token)
    const token =
      req.cookies?.["ad-token"] ||
      req.headers?.authorization?.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    // Verify token
    const decoded = jwt.verify(token, JWT_SECRET);

    // Check if this is a user token (has userId instead of adminId)
    if (decoded.userId) {
      return res.status(403).json({
        success: false,
        message:
          "User tokens cannot access admin routes. Please log in as an admin.",
      });
    }

    // Check if adminId exists
    if (!decoded.adminId) {
      return res.status(401).json({
        success: false,
        message: "Invalid token format",
      });
    }

    // Find admin
    const admin = await Admin.findById(decoded.adminId).select("-password");
    if (!admin) {
      return res.status(401).json({
        success: false,
        message: "Admin not found",
      });
    }

    if (!admin.isActive) {
      return res.status(401).json({
        success: false,
        message: "Admin account is inactive",
      });
    }

    // H-4: Token revocation via tokenVersion
    const tokenV = typeof decoded.v === "number" ? decoded.v : 0;
    const adminV = typeof admin.tokenVersion === "number" ? admin.tokenVersion : 0;
    if (tokenV !== adminV) {
      return res.status(401).json({
        success: false,
        message: "Token revoked",
      });
    }

    // Attach admin to request
    req.admin = admin;
    req.user = admin; // For compatibility with existing code
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
 * Generate JWT token for admin
 *
 * H-4: accepts the full admin object so `tokenVersion` is embedded.
 * Legacy callers passing a string adminId still work and sign with v=0.
 */
export const generateAdminToken = (adminOrId) => {
  let adminId;
  let v = 0;
  if (adminOrId && typeof adminOrId === "object") {
    adminId = adminOrId._id ? adminOrId._id.toString() : String(adminOrId);
    v = typeof adminOrId.tokenVersion === "number" ? adminOrId.tokenVersion : 0;
  } else {
    adminId = String(adminOrId);
  }
  // H-4: reduced lifetime from 30d → 7d
  return jwt.sign({ adminId, v }, JWT_SECRET, {
    expiresIn: "7d",
  });
};
