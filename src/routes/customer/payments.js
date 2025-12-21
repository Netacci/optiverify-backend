import express from "express";
import {
  createCheckoutSession,
  handleWebhook,
  manualUnlock,
  syncPaymentStatus,
  syncUserPayments,
} from "../../controllers/customer/paymentController.js";
import { sendTestEmail } from "../../services/emailService.js";
import { authenticate, optionalAuth } from "../../middleware/auth.js";

const router = express.Router();

// POST /api/payments/checkout - Create Stripe checkout session
// We allow unauthenticated access for public flow, but authenticated users are handled in controller
router.post("/checkout", optionalAuth, createCheckoutSession);

// POST /api/payments/sync - Sync all pending payments for the current user
router.post("/sync", authenticate, syncUserPayments);

// POST /api/payments/:requestId/sync - Sync payment status for a specific request (if webhook failed)
// Note: This only syncs the specific payment, not all payments/subscriptions
router.post("/:requestId/sync", authenticate, syncPaymentStatus);

// POST /api/payments/:requestId/unlock - Manual unlock for testing (development only)
router.post("/:requestId/unlock", manualUnlock);

// POST /api/payments/test-email - Test email endpoint (development only)
router.post("/test-email", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ success: false, message: "Email required" });
    }

    await sendTestEmail(email);
    res.json({ success: true, message: "Test email sent successfully" });
  } catch (error) {
    console.error("Test email error:", error);
    res.status(500).json({ 
      success: false, 
      message: "Failed to send test email",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
});

export default router;

