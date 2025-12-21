import express from "express";
import {
  verifyEmail,
  resendVerification,
  createPassword,
  login,
  logout,
  getCurrentUser,
  forgotPassword,
  resetPassword,
  emergencySessionSync,
} from "../../controllers/common/authController.js";
import { authenticate, optionalAuth } from "../../middleware/auth.js";

const router = express.Router();

console.log("Loading auth routes...");

// POST /api/auth/verify-email - Verify email token
router.get("/verify-email", verifyEmail);

// POST /api/auth/resend-verification - Resend verification email
router.post("/resend-verification", resendVerification);

// POST /api/auth/create-password - Create password for verified user
router.post("/create-password", createPassword);

// POST /api/auth/login - Login user
router.post("/login", login);

// POST /api/auth/logout - Logout user
router.post("/logout", logout);

// POST /api/auth/forgot-password - Request password reset
router.post("/forgot-password", forgotPassword);

// POST /api/auth/reset-password - Reset password with token
router.post("/reset-password", resetPassword);

// GET /api/auth/me - Get current user
router.get("/me", authenticate, getCurrentUser);

// POST /api/auth/emergency-session - Emergency session sync (syncs payments for user)
router.post("/emergency-session", authenticate, emergencySessionSync);

export default router;
