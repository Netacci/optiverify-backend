import express from "express";
import {
  getCategories,
  getSubcategories,
} from "../../controllers/admin/categoryController.js";

const router = express.Router();

// Public endpoint - Get active categories (for forms)
// GET /api/categories
router.get("/", getCategories);

// Public endpoint - Get active subcategories for a category
// GET /api/categories/:id/subcategories
router.get("/:id/subcategories", getSubcategories);

export default router;

