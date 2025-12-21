import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import {
  requireAdmin,
  requireSuperAdmin,
  getUsers,
  updateUser,
  getAdmins,
  createAdmin,
  updateAdmin,
  deleteAdmin,
  getDashboardStats,
} from "../../controllers/admin/adminController.js";
import {
  getSuppliers,
  createSupplier,
  updateSupplier,
  deleteSupplier,
  toggleSupplierStatus,
  bulkUploadSuppliers,
  upload,
} from "../../controllers/admin/supplierController.js";
import { getAllFeedback, updateFeedbackStatus, replyToFeedback } from "../../controllers/admin/feedbackController.js";

const router = express.Router();

// All admin routes require admin authentication
router.use(authenticateAdmin);

// Dashboard stats
router.get("/stats", requireAdmin, getDashboardStats);

// Suppliers
router.get("/suppliers", requireAdmin, getSuppliers);
router.post("/suppliers", requireAdmin, createSupplier);
router.post("/suppliers/bulk-upload", requireAdmin, upload.single("file"), bulkUploadSuppliers);
router.put("/suppliers/:id", requireAdmin, updateSupplier);
router.patch("/suppliers/:id/toggle-status", requireAdmin, toggleSupplierStatus);
router.delete("/suppliers/:id", requireAdmin, deleteSupplier);

// Feedback
router.get("/feedback", requireAdmin, getAllFeedback);
router.put("/feedback/:id", requireAdmin, updateFeedbackStatus);
router.post("/feedback/:id/reply", requireAdmin, replyToFeedback);

// Users
router.get("/users", requireAdmin, getUsers);
router.put("/users/:id", requireAdmin, updateUser);

// Admin management (super admin only)
router.get("/admins", requireAdmin, getAdmins);
router.post("/admins", requireSuperAdmin, createAdmin);
router.put("/admins/:id", requireSuperAdmin, updateAdmin);
router.delete("/admins/:id", requireSuperAdmin, deleteAdmin);

export default router;
