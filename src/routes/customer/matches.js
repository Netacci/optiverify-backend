import express from "express";
import {
  processMatching,
  getPreview,
  getFullReport,
} from "../../controllers/customer/matchController.js";

const router = express.Router();

// GET /api/matches/:id/preview - Get free preview (requestId)
router.get("/:id/preview", getPreview);

// GET /api/matches/:id/report - Get full report (paid/unlocked) (requestId)
router.get("/:id/report", getFullReport);

export default router;

