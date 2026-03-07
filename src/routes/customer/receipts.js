import express from "express";
import { authenticate } from "../../middleware/auth.js";
import {
  getPaymentReceipt,
  getManagedServiceReceipt,
  getManagedServiceSavingsFeeReceipt,
  getAllReceipts,
  getReceiptById,
} from "../../controllers/customer/receiptController.js";

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// GET /api/receipts - Get all receipts for current user
router.get("/", getAllReceipts);

// GET /api/receipts/payment/:paymentId - Get receipt for a regular payment
router.get("/payment/:paymentId", getPaymentReceipt);

// GET /api/receipts/managed-service/:serviceId - Get receipt for a managed service
router.get("/managed-service/:serviceId", getManagedServiceReceipt);

// GET /api/receipts/managed-service/:serviceId/savings-fee - Get receipt for a managed service savings fee
router.get("/managed-service/:serviceId/savings-fee", getManagedServiceSavingsFeeReceipt);

// GET /api/receipts/:transactionId - Get a single transaction receipt by ID (must be last)
router.get("/:transactionId", getReceiptById);

export default router;

