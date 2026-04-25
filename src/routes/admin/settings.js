import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { getSettings, updateSettings } from "../../controllers/admin/settingsController.js";
import { requireSuperAdmin } from "../../controllers/admin/adminController.js";

const router = express.Router();

// Get settings (admins can view)
router.get("/", authenticateAdmin, getSettings);

// Update settings (only super admin can update pricing).
// M-6: CSRF double-submit applied AFTER authentication and the role check.
router.put("/", authenticateAdmin, requireSuperAdmin, requireCsrf, updateSettings);

export default router;

