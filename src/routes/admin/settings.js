import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import { getSettings, updateSettings } from "../../controllers/admin/settingsController.js";
import { requireSuperAdmin } from "../../controllers/admin/adminController.js";

const router = express.Router();

// Get settings (admins can view)
router.get("/", authenticateAdmin, getSettings);

// Update settings (only super admin can update pricing)
router.put("/", authenticateAdmin, requireSuperAdmin, updateSettings);

export default router;

