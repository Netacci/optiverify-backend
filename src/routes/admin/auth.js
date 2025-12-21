import express from "express";
import {
  loginAdmin,
  logoutAdmin,
  getCurrentAdmin,
  changeAdminPassword,
} from "../../controllers/admin/adminAuthController.js";
import { authenticateAdmin } from "../../middleware/adminAuth.js";

const router = express.Router();

// POST /api/admin/auth/login - Login admin
router.post("/login", loginAdmin);

// POST /api/admin/auth/logout - Logout admin
router.post("/logout", logoutAdmin);

// GET /api/admin/auth/me - Get current admin
router.get("/me", authenticateAdmin, getCurrentAdmin);

// PUT /api/admin/auth/change-password - Change admin password
router.put("/change-password", authenticateAdmin, changeAdminPassword);

export default router;

