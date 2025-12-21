import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import {
  getAllMatchReports,
  getMatchReportDetails,
  updateMatchReport,
} from "../../controllers/admin/matchReportsController.js";

const router = express.Router();

router.use(authenticateAdmin);

// GET /api/admin/match-reports - Get all match reports
router.get("/", getAllMatchReports);

// GET /api/admin/match-reports/:id - Get single match report details
router.get("/:id", getMatchReportDetails);

// PUT /api/admin/match-reports/:id - Update match report
router.put("/:id", updateMatchReport);

export default router;

