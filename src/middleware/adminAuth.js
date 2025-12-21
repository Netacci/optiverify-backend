import jwt from "jsonwebtoken";
import Admin from "../models/admin/Admin.js";

const JWT_SECRET =
  process.env.JWT_SECRET || "your-jwt-secret-key-change-in-production";

/**
 * Verify JWT token from cookie for admin
 */
export const authenticateAdmin = async (req, res, next) => {
  try {
    // Get token from cookie (admin token)
    const token =
      req.cookies?.["ad-token"] || req.headers?.authorization?.replace("Bearer ", "");

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
        message: "User tokens cannot access admin routes. Please log in as an admin.",
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
 */
export const generateAdminToken = (adminId) => {
  return jwt.sign({ adminId }, JWT_SECRET, {
    expiresIn: "30d", // 30 days
  });
};

