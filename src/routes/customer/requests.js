import express from "express";
import {
  createRequest,
  getRequestById,
  // C-3: getAllRequests is intentionally NOT mounted as a route — exported for
  // future admin-only rewrite (renamed _getAllRequests_DEPRECATED in controller).
} from "../../controllers/customer/requestController.js";
import { getRequestDetails, unlockRequest } from "../../controllers/customer/dashboardController.js";
import { processMatching, generateAIMatch } from "../../controllers/customer/matchController.js";
import { optionalAuth, authenticate } from "../../middleware/auth.js";

const router = express.Router();

// POST /api/requests - Submit buyer intake form (optional auth for dashboard users)
router.post("/", optionalAuth, createRequest);

// C-3: REMOVED `router.get("/", getAllRequests)` — this dumped every buyer
// request in the system (PII: email, item, quantity, budget, location) to any
// anonymous caller. Replace with an admin-gated /api/admin/requests endpoint
// when needed.

// POST /api/requests/:id/match - Process request and match suppliers
router.post("/:id/match", optionalAuth, processMatching);

// POST /api/requests/:id/generate-match - Generate AI match for pending reports (authenticated only)
router.post("/:id/generate-match", authenticate, generateAIMatch);

// POST /api/requests/:id/unlock - Unlock request using credits
router.post("/:id/unlock", authenticate, unlockRequest);

// GET /api/requests/:id/details - Get request with match details (authenticated)
// This must come before /:id to avoid route conflicts
router.get("/:id/details", authenticate, getRequestDetails);

// GET /api/requests/:id - Get a specific request (C-3: now requires auth +
// ownership check enforced inside the controller).
router.get("/:id", authenticate, getRequestById);

export default router;
