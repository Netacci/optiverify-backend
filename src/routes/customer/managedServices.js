import express from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  initiateRequest,
  initiatePublicRequest,
  getUserRequests,
  getRequestDetails,
  createPaymentSession,
  createSavingsFeePaymentSession,
  syncPaymentStatus,
  updateRequest,
} from "../../controllers/customer/managedServiceController.js";

const router = express.Router();

// Public endpoint for website submissions (no auth required)
// POST /api/managed-services/public/initiate - Start a new request (public)
router.post("/public/initiate", initiatePublicRequest);

// Public payment endpoint (no auth required for public submissions)
// POST /api/managed-services/payment/create-session - Create Stripe checkout session
router.post("/payment/create-session", createPaymentSession);

// Authenticated routes
router.use(authenticate);

// POST /api/managed-services/initiate - Start a new request (authenticated)
router.post("/initiate", initiateRequest);

// GET /api/managed-services - Get all my requests
router.get("/", getUserRequests);

// POST /api/managed-services/:id/sync-payment - Sync payment status (if webhook failed)
router.post("/:id/sync-payment", syncPaymentStatus);

// POST /api/managed-services/:id/savings-fee/payment - Create Stripe session for savings fee payment
router.post("/:id/savings-fee/payment", createSavingsFeePaymentSession);

// GET /api/managed-services/:id - Get details
router.get("/:id", getRequestDetails);

// PUT /api/managed-services/:id - Update request (if editable)
router.put("/:id", updateRequest);

export default router;

