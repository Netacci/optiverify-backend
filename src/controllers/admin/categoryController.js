import Category from "../../models/admin/Category.js";
import multer from "multer";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `subcategory-upload-${Date.now()}${path.extname(file.originalname)}`);
  },
});

export const upload = multer({ storage });

/**
 * Get all categories
 */
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find({ isActive: true })
      .sort({ name: 1 })
      .select("name grade isActive");

    res.json({
      success: true,
      data: categories,
    });
  } catch (error) {
    console.error("Error getting categories:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get all categories (including inactive) - Admin only
 */
export const getAllCategories = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { isActive } = req.query;
    const query = {};
    if (isActive !== undefined) {
      query.isActive = isActive === "true";
    }

    const [categories, total] = await Promise.all([
      Category.find(query)
        .sort({ name: 1 })
        .populate("createdBy", "email")
        .skip(skip)
        .limit(limit),
      Category.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        categories,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting all categories:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Create a new category
 */
export const createCategory = async (req, res) => {
  try {
    const { name, grade } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Category name is required",
      });
    }

    // Check if category already exists
    const existing = await Category.findOne({
      name: name.trim(),
    });

    if (existing) {
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });
    }

    const category = await Category.create({
      name: name.trim(),
      grade: grade || "medium",
      createdBy: req.admin._id,
    });

    res.status(201).json({
      success: true,
      message: "Category created successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error creating category:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Category already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update a category
 */
export const updateCategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name, grade, isActive } = req.body;

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    if (name) {
      // Check if name already exists (excluding current category)
      const existing = await Category.findOne({
        name: name.trim(),
        _id: { $ne: id },
      });

      if (existing) {
        return res.status(400).json({
          success: false,
          message: "Category name already exists",
        });
      }

      category.name = name.trim();
    }

    if (grade !== undefined) {
      category.grade = grade;
    }

    if (isActive !== undefined) {
      category.isActive = isActive;
    }

    await category.save();

    res.json({
      success: true,
      message: "Category updated successfully",
      data: category,
    });
  } catch (error) {
    console.error("Error updating category:", error);
    if (error.code === 11000) {
      return res.status(400).json({
        success: false,
        message: "Category name already exists",
      });
    }
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Delete a category
 */
export const deleteCategory = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    await Category.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Category deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting category:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get a single category by ID (admin)
 */
export const getCategoryById = async (req, res) => {
  try {
    const { id } = req.params;
    const category = await Category.findById(id);

    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    res.json({ success: true, data: category });
  } catch (error) {
    console.error("Error getting category:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Add a subcategory to a category (admin)
 */
export const addSubcategory = async (req, res) => {
  try {
    const { id } = req.params;
    const { name } = req.body;

    if (!name || !name.trim()) {
      return res.status(400).json({
        success: false,
        message: "Subcategory name is required",
      });
    }

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const exists = category.subcategories.some(
      (s) => s.name.toLowerCase() === name.trim().toLowerCase()
    );
    if (exists) {
      return res.status(400).json({
        success: false,
        message: "Subcategory already exists",
      });
    }

    category.subcategories.push({ name: name.trim() });
    await category.save();

    res.status(201).json({ success: true, data: category });
  } catch (error) {
    console.error("Error adding subcategory:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Update a subcategory (admin)
 */
export const updateSubcategory = async (req, res) => {
  try {
    const { id, subId } = req.params;
    const { name } = req.body;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const sub = category.subcategories.id(subId);
    if (!sub) {
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    if (name && name.trim()) {
      sub.name = name.trim();
    }

    await category.save();
    res.json({ success: true, data: category });
  } catch (error) {
    console.error("Error updating subcategory:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Delete a subcategory (admin)
 */
export const deleteSubcategory = async (req, res) => {
  try {
    const { id, subId } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const sub = category.subcategories.id(subId);
    if (!sub) {
      return res.status(404).json({
        success: false,
        message: "Subcategory not found",
      });
    }

    sub.deleteOne();
    await category.save();

    res.json({ success: true, message: "Subcategory deleted successfully" });
  } catch (error) {
    console.error("Error deleting subcategory:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Get active subcategories for a category (public)
 */
export const getSubcategories = async (req, res) => {
  try {
    const { id } = req.params;

    const category = await Category.findById(id);
    if (!category) {
      return res.status(404).json({
        success: false,
        message: "Category not found",
      });
    }

    const active = category.subcategories.filter((s) => s.isActive);
    res.json({ success: true, data: active });
  } catch (error) {
    console.error("Error getting subcategories:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

/**
 * Bulk upload subcategories from CSV/Excel (admin)
 * Expected columns: name (or subcategory, subcategory_name)
 */
export const bulkUploadSubcategories = async (req, res) => {
  try {
    const { id } = req.params;

    if (!req.file) {
      return res.status(400).json({ success: false, message: "No file uploaded" });
    }

    const category = await Category.findById(id);
    if (!category) {
      fs.unlinkSync(req.file.path);
      return res.status(404).json({ success: false, message: "Category not found" });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    if (fileExtension === ".csv") {
      const csvParser = (await import("csv-parser")).default;
      const results = [];
      await new Promise((resolve, reject) => {
        fs.createReadStream(filePath)
          .pipe(csvParser())
          .on("data", (data) => results.push(data))
          .on("end", resolve)
          .on("error", reject);
      });
      rows = results;
    } else if (fileExtension === ".xlsx" || fileExtension === ".xls") {
      const workbook = xlsx.readFile(filePath);
      const sheetName = workbook.SheetNames[0];
      rows = xlsx.utils.sheet_to_json(workbook.Sheets[sheetName]);
    } else {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: "Unsupported file format. Please upload a CSV or Excel file.",
      });
    }

    fs.unlinkSync(filePath);

    if (rows.length === 0) {
      return res.status(400).json({
        success: false,
        message: "File is empty or could not be parsed",
      });
    }

    // Accept any of these column headers for the name
    const nameKeys = ["name", "subcategory", "subcategory_name", "subcategoryname"];
    const resolveNameKey = (row) => {
      const keys = Object.keys(row).map((k) => k.toLowerCase().trim().replace(/\s+/g, "_"));
      for (const k of nameKeys) {
        const match = Object.keys(row).find(
          (rk) => rk.toLowerCase().trim().replace(/\s+/g, "_") === k
        );
        if (match) return row[match];
      }
      return null;
    };

    let imported = 0;
    let skipped = 0;
    const errors = [];

    for (let i = 0; i < rows.length; i++) {
      const name = resolveNameKey(rows[i]);

      if (!name || !String(name).trim()) {
        errors.push({ row: i + 2, message: "Missing subcategory name" });
        continue;
      }

      const trimmedName = String(name).trim();

      const exists = category.subcategories.some(
        (s) => s.name.toLowerCase() === trimmedName.toLowerCase()
      );

      if (exists) {
        skipped++;
        continue;
      }

      category.subcategories.push({ name: trimmedName });
      imported++;
    }

    await category.save();

    res.json({
      success: true,
      message: `Bulk upload complete: ${imported} added, ${skipped} skipped (duplicates)${errors.length ? `, ${errors.length} errors` : ""}.`,
      data: {
        imported,
        skipped,
        errors,
        category,
      },
    });
  } catch (error) {
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlinkSync(req.file.path);
    }
    console.error("Error bulk uploading subcategories:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};
