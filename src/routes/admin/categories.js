import express from "express";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import {
  getAllCategories,
  createCategory,
  updateCategory,
  deleteCategory,
} from "../../controllers/admin/categoryController.js";

const router = express.Router();

router.use(authenticateAdmin);

// GET /api/admin/categories - Get all categories (including inactive)
router.get("/", getAllCategories);

// POST /api/admin/categories - Create a new category
router.post("/", createCategory);

// PUT /api/admin/categories/:id - Update a category
router.put("/:id", updateCategory);

// DELETE /api/admin/categories/:id - Delete a category
router.delete("/:id", deleteCategory);

export default router;

