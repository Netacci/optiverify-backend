import express from "express";
import { authenticate } from "../../middleware/auth.js";
import { submitFeedback, getFeedback, replyToFeedback } from "../../controllers/customer/feedbackController.js";

const router = express.Router();

// Get all feedback (authenticated users)
router.get("/", authenticate, getFeedback);

// Submit feedback (authenticated users)
router.post("/", authenticate, submitFeedback);

// Reply to feedback (authenticated users)
router.post("/:id/reply", authenticate, replyToFeedback);

export default router;
