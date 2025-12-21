import express from "express";
import {
  createRequest,
  getRequestById,
  getAllRequests,
} from "../../controllers/customer/requestController.js";
import { getRequestDetails, unlockRequest } from "../../controllers/customer/dashboardController.js";
import { processMatching, generateAIMatch } from "../../controllers/customer/matchController.js";
import { optionalAuth, authenticate } from "../../middleware/auth.js";

const router = express.Router();

// POST /api/requests - Submit buyer intake form (optional auth for dashboard users)
router.post("/", optionalAuth, createRequest);

// GET /api/requests - Get all requests (for admin/testing)
router.get("/", getAllRequests);

// POST /api/requests/:id/match - Process request and match suppliers
router.post("/:id/match", optionalAuth, processMatching);

// POST /api/requests/:id/generate-match - Generate AI match for pending reports (authenticated only)
router.post("/:id/generate-match", authenticate, generateAIMatch);

// POST /api/requests/:id/unlock - Unlock request using credits
router.post("/:id/unlock", authenticate, unlockRequest);

// GET /api/requests/:id/details - Get request with match details (authenticated)
// This must come before /:id to avoid route conflicts
router.get("/:id/details", authenticate, getRequestDetails);

// GET /api/requests/:id - Get a specific request
router.get("/:id", getRequestById);

export default router;
