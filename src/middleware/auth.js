import jwt from "jsonwebtoken";
import User from "../models/common/User.js";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-jwt-secret-key-change-in-production";

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
 */
export const generateToken = (userId) => {
  return jwt.sign({ userId }, JWT_SECRET, {
    expiresIn: "30d", // 30 days
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
            req.user = user;
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
