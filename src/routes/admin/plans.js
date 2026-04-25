import express from "express";
import {
  getPlans,
  getPlanById,
  createPlan,
  updatePlan,
  deletePlan,
} from "../../controllers/admin/planController.js";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import { requireCsrf } from "../../middleware/csrf.js";
import { requireAdmin } from "../../controllers/admin/adminController.js";

const router = express.Router();

// All plan routes require admin authentication.
// M-6: CSRF check applied AFTER auth + role check; safe methods bypass it.
router.use(authenticateAdmin);
router.use(requireAdmin);
router.use(requireCsrf);

// GET /api/admin/plans - Get all plans
router.get("/", getPlans);

// GET /api/admin/plans/:id - Get single plan
router.get("/:id", getPlanById);

// POST /api/admin/plans - Create new plan
router.post("/", createPlan);

// PUT /api/admin/plans/:id - Update plan
router.put("/:id", updatePlan);

// DELETE /api/admin/plans/:id - Delete plan
router.delete("/:id", deletePlan);

export default router;

