import express from "express";
import { getCategories } from "../../controllers/admin/categoryController.js";

const router = express.Router();

// Public endpoint - Get active categories (for forms)
// GET /api/categories
router.get("/", getCategories);

export default router;

