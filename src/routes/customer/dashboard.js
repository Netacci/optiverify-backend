import express from "express";
import {
  getUserRequests,
  getRequestDetails,
  getSubscriptionStatus,
  getCreditTransactions,
} from "../../controllers/customer/dashboardController.js";
import { authenticate } from "../../middleware/auth.js";

const router = express.Router();

// All dashboard routes require authentication
router.use(authenticate);

// GET /api/dashboard/requests - Get user's requests
router.get("/requests", getUserRequests);

// GET /api/dashboard/requests/:id - Get single request with matches
router.get("/requests/:id", getRequestDetails);

// GET /api/dashboard/subscription - Get subscription status
router.get("/subscription", getSubscriptionStatus);

// GET /api/dashboard/credit-transactions - Get credit transactions
router.get("/credit-transactions", getCreditTransactions);

export default router;
