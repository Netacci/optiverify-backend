import express from "express";
import rateLimit from "express-rate-limit";
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

// H-1 (narrowed): rate limit ONLY the AI fan-out endpoints. Each call to
// /:id/match or /:id/generate-match triggers ~11 OpenAI completions, so 5/min
// per user is the right ceiling for cost-DoS protection. Apply it inline so
// the router-level limiter in server.js (generalLimiter, 300/15min) governs
// the GET /:id/details, POST / (create), POST /:id/unlock, etc., which are
// not AI-cost amplifiers and should not share the AI bucket.
//
// Wave 1C originally mounted aiLimiter on the whole /api/requests router
// as a TODO; this is the follow-up.
const aiLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});

// POST /api/requests - Submit buyer intake form (optional auth for dashboard users)
router.post("/", optionalAuth, createRequest);

// C-3: REMOVED `router.get("/", getAllRequests)` — this dumped every buyer
// request in the system (PII: email, item, quantity, budget, location) to any
// anonymous caller. Replace with an admin-gated /api/admin/requests endpoint
// when needed.

// POST /api/requests/:id/match - Process request and match suppliers (AI-bound)
router.post("/:id/match", aiLimiter, optionalAuth, processMatching);

// POST /api/requests/:id/generate-match - Generate AI match for pending reports (AI-bound, authenticated only)
router.post("/:id/generate-match", aiLimiter, authenticate, generateAIMatch);

// POST /api/requests/:id/unlock - Unlock request using credits
router.post("/:id/unlock", authenticate, unlockRequest);

// GET /api/requests/:id/details - Get request with match details (authenticated)
// This must come before /:id to avoid route conflicts
router.get("/:id/details", authenticate, getRequestDetails);

// GET /api/requests/:id - Get a specific request (C-3: now requires auth +
// ownership check enforced inside the controller).
router.get("/:id", authenticate, getRequestById);

export default router;
