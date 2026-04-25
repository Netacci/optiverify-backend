import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import { requireCsrf } from "../../middleware/csrf.js";
import {
  getAllCategories,
  getCategoryById,
  createCategory,
  updateCategory,
  deleteCategory,
  addSubcategory,
  updateSubcategory,
  deleteSubcategory,
  getSubcategories,
  bulkUploadSubcategories,
  upload,
} from "../../controllers/admin/categoryController.js";

const router = express.Router();

// M-6: auth + CSRF double-submit on all non-safe methods.
router.use(authenticateAdmin);
router.use(requireCsrf);

// GET /api/admin/categories - Get all categories (including inactive)
router.get("/", getAllCategories);

// POST /api/admin/categories - Create a new category
router.post("/", createCategory);

// GET /api/admin/categories/:id - Get a single category with subcategories
router.get("/:id", getCategoryById);

// PUT /api/admin/categories/:id - Update a category
router.put("/:id", updateCategory);

// DELETE /api/admin/categories/:id - Delete a category
router.delete("/:id", deleteCategory);

// GET /api/admin/categories/:id/subcategories - Get subcategories (admin)
router.get("/:id/subcategories", getSubcategories);

// POST /api/admin/categories/:id/subcategories - Add a subcategory
router.post("/:id/subcategories", addSubcategory);

// PUT /api/admin/categories/:id/subcategories/:subId - Update a subcategory
router.put("/:id/subcategories/:subId", updateSubcategory);

// DELETE /api/admin/categories/:id/subcategories/:subId - Delete a subcategory
router.delete("/:id/subcategories/:subId", deleteSubcategory);

// POST /api/admin/categories/:id/subcategories/bulk-upload - Bulk upload subcategories
router.post("/:id/subcategories/bulk-upload", upload.single("file"), bulkUploadSubcategories);

export default router;

