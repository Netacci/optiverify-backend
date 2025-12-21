import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import {
  getAllRequests,
  getRequestDetails,
  updateStage,
  updateQuotes,
  saveReport,
} from "../../controllers/admin/managedServiceAdminController.js";

const router = express.Router();

router.use(authenticateAdmin);

// GET /api/admin/managed-services - List all requests
router.get("/", getAllRequests);

// GET /api/admin/managed-services/:id - Get details
router.get("/:id", getRequestDetails);

// PATCH /api/admin/managed-services/:id/stage - Move workflow stage
router.patch("/:id/stage", updateStage);

// PATCH /api/admin/managed-services/:id/quotes - Input quotes & financials
router.patch("/:id/quotes", updateQuotes);

// POST /api/admin/managed-services/:id/report - Save final report
router.post("/:id/report", saveReport);

export default router;
