import Supplier from "../../models/admin/Supplier.js";
import multer from "multer";
import xlsx from "xlsx";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = path.join(__dirname, "../../../uploads");
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    cb(null, `${Date.now()}-${file.originalname}`);
  },
});

export const upload = multer({
  storage: storage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      "text/csv",
      "application/vnd.ms-excel",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ];
    if (
      allowedMimes.includes(file.mimetype) ||
      file.originalname.endsWith(".csv") ||
      file.originalname.endsWith(".xlsx") ||
      file.originalname.endsWith(".xls")
    ) {
      cb(null, true);
    } else {
      cb(
        new Error("Invalid file type. Only CSV and Excel files are allowed."),
        false
      );
    }
  },
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB limit
});

/**
 * Get all suppliers
 */
export const getSuppliers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { category, search, isActive } = req.query;
    const query = {};

    if (category) query.category = category;
    if (isActive !== undefined) query.isActive = isActive === "true";
    if (search) {
      query.$or = [
        { name: { $regex: search, $options: "i" } },
        { description: { $regex: search, $options: "i" } },
        { location: { $regex: search, $options: "i" } },
      ];
    }

    const [suppliers, total] = await Promise.all([
      Supplier.find(query).sort({ createdAt: -1 }).skip(skip).limit(limit),
      Supplier.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        suppliers,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting suppliers:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get supplier by ID
 */
export const getSupplierById = async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await Supplier.findById(id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      data: supplier,
    });
  } catch (error) {
    console.error("Error getting supplier:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Create supplier
 */
export const createSupplier = async (req, res) => {
  try {
    // Clean up the data - remove empty strings and convert date strings to Date objects
    const supplierData = { ...req.body };
    
    // Convert empty strings to undefined for optional fields
    Object.keys(supplierData).forEach((key) => {
      if (supplierData[key] === "" || supplierData[key] === null) {
        // Keep required fields, but remove optional empty fields
        if (!["name", "category", "description", "location", "email"].includes(key)) {
          delete supplierData[key];
        }
      }
    });

    // Convert lastVerifiedDate string to Date if provided
    if (supplierData.lastVerifiedDate && typeof supplierData.lastVerifiedDate === "string") {
      supplierData.lastVerifiedDate = new Date(supplierData.lastVerifiedDate);
    }

    // Ensure arrays are properly formatted
    if (supplierData.certifications && !Array.isArray(supplierData.certifications)) {
      supplierData.certifications = [];
    }
    if (supplierData.capabilities && !Array.isArray(supplierData.capabilities)) {
      supplierData.capabilities = [];
    }
    if (supplierData.keywords && !Array.isArray(supplierData.keywords)) {
      supplierData.keywords = [];
    }

    const supplier = await Supplier.create(supplierData);

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Error creating supplier:", error);
    
    // Handle validation errors
    if (error.name === "ValidationError") {
      const errors = Object.values(error.errors).map((err) => err.message);
      return res.status(400).json({
        success: false,
        message: "Validation error",
        errors,
        error: process.env.NODE_ENV === "development" ? error.message : undefined,
      });
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update supplier
 */
export const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await Supplier.findByIdAndUpdate(id, req.body, {
      new: true,
      runValidators: true,
    });

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier updated successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Error updating supplier:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete supplier
 */
export const deleteSupplier = async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await Supplier.findByIdAndDelete(id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    res.json({
      success: true,
      message: "Supplier deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting supplier:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Bulk upload suppliers from CSV/Excel file
 */
export const bulkUploadSuppliers = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file uploaded",
      });
    }

    const filePath = req.file.path;
    const fileExtension = path.extname(req.file.originalname).toLowerCase();
    let rows = [];

    // Parse file based on extension
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
      const worksheet = workbook.Sheets[sheetName];
      rows = xlsx.utils.sheet_to_json(worksheet);
    } else {
      // Clean up file
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: "Unsupported file format. Please upload CSV or Excel file.",
      });
    }

    if (rows.length === 0) {
      fs.unlinkSync(filePath);
      return res.status(400).json({
        success: false,
        message: "File is empty or could not be parsed",
      });
    }

    // Normalize column names (case-insensitive, handle spaces/underscores)
    const normalizeKey = (key) => {
      if (!key) return key;
      return key
        .toString()
        .toLowerCase()
        .trim()
        .replace(/\s+/g, "_")
        .replace(/-/g, "_");
    };

    // Required fields
    const requiredFields = [
      "name",
      "category",
      "description",
      "location",
      "email",
    ];
    const errors = [];
    const suppliers = [];
    const skipped = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2; // +2 because row 1 is header and arrays are 0-indexed

      // Normalize row keys
      const normalizedRow = {};
      Object.keys(row).forEach((key) => {
        normalizedRow[normalizeKey(key)] = row[key];
      });

      // Check required fields
      const missingFields = requiredFields.filter(
        (field) =>
          !normalizedRow[field] || !normalizedRow[field].toString().trim()
      );
      if (missingFields.length > 0) {
        errors.push({
          row: rowNum,
          message: `Missing required fields: ${missingFields.join(", ")}`,
        });
        skipped.push({ row: rowNum, data: normalizedRow });
        continue;
      }

      // Validate email format
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(normalizedRow.email.toString().trim())) {
        errors.push({
          row: rowNum,
          message: `Invalid email format: ${normalizedRow.email}`,
        });
        skipped.push({ row: rowNum, data: normalizedRow });
        continue;
      }

      // Build supplier object
      const supplierData = {
        name: normalizedRow.name.toString().trim(),
        category: normalizedRow.category.toString().trim(),
        description: normalizedRow.description.toString().trim(),
        location: normalizedRow.location.toString().trim(),
        email: normalizedRow.email.toString().trim().toLowerCase(),
        // New fields - optional
        subCategory: normalizedRow.sub_category || normalizedRow.subcategory
          ? normalizedRow.sub_category || normalizedRow.subcategory
          : "",
        country: normalizedRow.country ? normalizedRow.country.toString().trim() : "",
        stateRegion: normalizedRow.state_region || normalizedRow.stateregion || normalizedRow.state
          ? (normalizedRow.state_region || normalizedRow.stateregion || normalizedRow.state).toString().trim()
          : "",
        city: normalizedRow.city ? normalizedRow.city.toString().trim() : "",
        contactName: normalizedRow.contact_name || normalizedRow.contactname
          ? (normalizedRow.contact_name || normalizedRow.contactname).toString().trim()
          : "",
        phone: normalizedRow.phone ? normalizedRow.phone.toString().trim() : "",
        website: normalizedRow.website
          ? normalizedRow.website.toString().trim()
          : "",
        certifications: normalizedRow.certifications
          ? normalizedRow.certifications
              .toString()
              .split(",")
              .map((c) => c.trim())
              .filter((c) => c)
          : [],
        diversityType: normalizedRow.diversity_type || normalizedRow.diversitytype
          ? (normalizedRow.diversity_type || normalizedRow.diversitytype).toString().trim()
          : "",
        capabilities: normalizedRow.capabilities || normalizedRow.primary_products || normalizedRow.primaryproducts
          ? (normalizedRow.capabilities || normalizedRow.primary_products || normalizedRow.primaryproducts)
              .toString()
              .split(",")
              .map((c) => c.trim())
              .filter((c) => c)
          : [],
        minOrderQuantity:
          normalizedRow.min_order_quantity ||
          normalizedRow.minorderquantity ||
          normalizedRow.moq
            ? (
                normalizedRow.min_order_quantity ||
                normalizedRow.minorderquantity ||
                normalizedRow.moq
              )
                .toString()
                .trim()
            : "",
        leadTime:
          normalizedRow.lead_time || normalizedRow.leadtime
            ? (normalizedRow.lead_time || normalizedRow.leadtime)
                .toString()
                .trim()
            : "",
        annualCapacity: normalizedRow.annual_capacity || normalizedRow.annualcapacity || normalizedRow.volume_notes || normalizedRow.volumenotes
          ? (normalizedRow.annual_capacity || normalizedRow.annualcapacity || normalizedRow.volume_notes || normalizedRow.volumenotes).toString().trim()
          : "",
        industry: normalizedRow.industry ? normalizedRow.industry.toString().trim() : "",
        riskFlags: normalizedRow.risk_flags || normalizedRow.riskflags
          ? (normalizedRow.risk_flags || normalizedRow.riskflags).toString().trim()
          : "",
        dataSource: normalizedRow.data_source || normalizedRow.datasource
          ? (normalizedRow.data_source || normalizedRow.datasource).toString().trim()
          : "",
        keywords: normalizedRow.keywords
          ? normalizedRow.keywords
              .toString()
              .split(",")
              .map((k) => k.trim())
              .filter((k) => k)
          : [],
        verified: normalizedRow.verified !== undefined
          ? normalizedRow.verified.toString().toLowerCase() === "true" ||
            normalizedRow.verified.toString().toLowerCase() === "yes" ||
            normalizedRow.verified.toString() === "1"
          : false,
        lastVerifiedDate: normalizedRow.last_verified_date || normalizedRow.lastverifieddate
          ? new Date(normalizedRow.last_verified_date || normalizedRow.lastverifieddate)
          : undefined,
        internalNotes: normalizedRow.internal_notes || normalizedRow.internalnotes
          ? (normalizedRow.internal_notes || normalizedRow.internalnotes).toString().trim()
          : "",
        buyerMatchRecommendation: normalizedRow.buyer_match_recommendation || normalizedRow.buyermatchrecommendation
          ? (normalizedRow.buyer_match_recommendation || normalizedRow.buyermatchrecommendation).toString().trim()
          : "",
        isActive:
          normalizedRow.is_active !== undefined
            ? normalizedRow.is_active.toString().toLowerCase() === "true" ||
              normalizedRow.is_active.toString() === "1"
            : true,
      };

      suppliers.push(supplierData);
    }

    // Clean up uploaded file
    fs.unlinkSync(filePath);

    if (suppliers.length === 0) {
      return res.status(400).json({
        success: false,
        message: "No valid suppliers found in file",
        errors,
        skipped: skipped.length,
      });
    }

    // Insert suppliers in bulk
    const result = await Supplier.insertMany(suppliers, {
      ordered: false,
    }).catch((error) => {
      // Handle duplicate key errors (e.g., duplicate emails)
      if (error.writeErrors) {
        const duplicateErrors = error.writeErrors.map((err) => ({
          row: "unknown",
          message: err.errmsg || "Duplicate entry",
        }));
        return { hasErrors: true, errors: duplicateErrors };
      }
      throw error;
    });

    if (result && result.hasErrors) {
      return res.status(400).json({
        success: false,
        message: "Some suppliers could not be imported",
        errors: [...errors, ...result.errors],
        imported: suppliers.length - (result.errors?.length || 0),
        skipped: skipped.length,
      });
    }

    res.json({
      success: true,
      message: `Successfully imported ${suppliers.length} supplier(s)`,
      data: {
        imported: suppliers.length,
        errors: errors.length,
        skipped: skipped.length,
        errorsDetails: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("Error bulk uploading suppliers:", error);

    // Clean up file if it exists
    if (req.file && req.file.path && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (unlinkError) {
        console.error("Error deleting file:", unlinkError);
      }
    }

    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Toggle supplier active status
 */
export const toggleSupplierStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const supplier = await Supplier.findById(id);

    if (!supplier) {
      return res.status(404).json({
        success: false,
        message: "Supplier not found",
      });
    }

    supplier.isActive = !supplier.isActive;
    await supplier.save();

    res.json({
      success: true,
      data: supplier,
      message: `Supplier ${
        supplier.isActive ? "activated" : "deactivated"
      } successfully`,
    });
  } catch (error) {
    console.error("Error toggling supplier status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

