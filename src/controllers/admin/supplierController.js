import Supplier from "../../models/admin/Supplier.js";
import multer from "multer";
import ExcelJS from "exceljs";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// M-11: SheetJS xlsx@0.18.5 is no longer published to npm and has open
// prototype-pollution / ReDoS reports. We replaced it with exceljs and a
// hardened reader that caps row/column counts to defang zip-bomb-style
// payloads (a malicious .xlsx can advertise millions of rows in a few KB).
const MAX_SHEET_ROWS = 10000;
const MAX_SHEET_COLS = 100;

/**
 * Load an .xlsx/.xls workbook from disk and return the first worksheet's rows
 * as an array of plain objects keyed by the header row — mirroring the shape
 * that `xlsx.utils.sheet_to_json` produced for the rest of this controller.
 *
 * Throws a tagged Error (`code: "SHEET_TOO_LARGE"`) if the worksheet exceeds
 * the row/column caps so callers can surface a 400 instead of a 500.
 */
async function readXlsxAsJson(filePath) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];
  return sheetToJson(worksheet);
}

/**
 * Convert an exceljs worksheet to an array of `{header: cellValue}` objects.
 * Row 1 is treated as the header row. Empty header cells are skipped so the
 * returned objects don't carry undefined keys.
 *
 * Enforces MAX_SHEET_ROWS / MAX_SHEET_COLS up-front against the worksheet's
 * advertised counts so we don't iterate a hostile file before rejecting it.
 */
function sheetToJson(worksheet) {
  const rowCount = worksheet.actualRowCount || worksheet.rowCount || 0;
  const colCount = worksheet.actualColumnCount || worksheet.columnCount || 0;

  // rowCount includes the header row; cap *data* rows at MAX_SHEET_ROWS.
  if (rowCount - 1 > MAX_SHEET_ROWS || colCount > MAX_SHEET_COLS) {
    const err = new Error(
      `Worksheet too large: max ${MAX_SHEET_ROWS} data rows and ${MAX_SHEET_COLS} columns allowed (got ${Math.max(rowCount - 1, 0)} rows, ${colCount} columns).`
    );
    err.code = "SHEET_TOO_LARGE";
    throw err;
  }

  const headerRow = worksheet.getRow(1);
  const headers = [];
  headerRow.eachCell({ includeEmpty: true }, (cell, colNumber) => {
    const raw = cell.value;
    headers[colNumber - 1] =
      raw == null || raw === ""
        ? null
        : typeof raw === "object" && raw.text
        ? String(raw.text)
        : String(raw);
  });

  const rows = [];
  for (let r = 2; r <= rowCount; r++) {
    const row = worksheet.getRow(r);
    const obj = {};
    let hasValue = false;
    row.eachCell({ includeEmpty: false }, (cell, colNumber) => {
      const key = headers[colNumber - 1];
      if (!key) return; // skip cells under blank header
      obj[key] = normalizeCellValue(cell.value);
      hasValue = true;
    });
    if (hasValue) rows.push(obj);
  }
  return rows;
}

/**
 * exceljs returns rich cell objects for formulas / hyperlinks / rich text and
 * Date instances for date cells. The downstream code in this file calls
 * `.toString().trim()` on every value, so we flatten to a primitive here.
 */
function normalizeCellValue(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("text" in value) return String(value.text);
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((rt) => rt.text || "").join("");
    }
    if ("hyperlink" in value) return String(value.text || value.hyperlink || "");
  }
  return value;
}

// C-5: Mass-assignment defense. Spreading req.body into Supplier.create /
// findByIdAndUpdate let any caller stamp `verified`, `isActive`,
// `internalNotes`, `buyerMatchRecommendation`, or `supplierNumber` directly,
// which a junior admin could abuse to deactivate competitors or self-mark
// unverified suppliers as verified. We now build the update payload from two
// explicit allowlists; privileged fields require superAdmin.
//
// Field names below MUST match the Supplier schema EXACTLY (see
// models/admin/Supplier.js). The Wave 1 report flagged that the original
// allowlist used `subcategory` (lowercase), `location`, and several
// non-existent fields (`yearEstablished`, `employeeCount`, `description`,
// `logo`) — those have been reconciled here.
const SUPPLIER_USER_FIELDS = [
  "name",
  "category",
  "subCategory",
  "email",
  "phone",
  "website",
  "country",
  "stateRegion",
  "city",
  "contactName",
  "capabilities",
  "certifications",
  "diversityType",
  "minOrderQuantity",
  "leadTime",
  "annualCapacity",
  "industry",
  "riskFlags",
  "dataSource",
  "businessVerification",
];

// Privileged fields require superAdmin. `lastVerifiedDate` is grouped here
// because it is the audit timestamp that backs the `verified` flag — letting
// a junior admin set it independently would defeat the privilege check on
// `verified` itself.
const SUPPLIER_PRIVILEGED_FIELDS = [
  "verified",
  "lastVerifiedDate",
  "isActive",
  "internalNotes",
  "buyerMatchRecommendation",
];

function pickFields(body, fields) {
  const o = {};
  if (!body || typeof body !== "object") return o;
  for (const k of fields) {
    if (body[k] !== undefined) o[k] = body[k];
  }
  return o;
}

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
 * Generate a unique supplier number in format OV0000000 (9 chars total)
 */
const generateSupplierNumber = async () => {
  let supplierNumber;
  do {
    const digits = String(Math.floor(Math.random() * 9999999 + 1)).padStart(7, "0");
    supplierNumber = `OV${digits}`;
  } while (await Supplier.exists({ supplierNumber }));
  return supplierNumber;
};

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
        { category: { $regex: search, $options: "i" } },
        { supplierNumber: { $regex: search, $options: "i" } },
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
 *
 * C-5: build the create payload from explicit allowlists. supplierNumber is
 * auto-generated server-side and MUST never be accepted from the request body.
 * `_id`, `createdAt`, `updatedAt`, `__v` are likewise never honored — pickFields
 * only copies fields whose names appear in the allowlist.
 */
export const createSupplier = async (req, res) => {
  try {
    const supplierData = pickFields(req.body, SUPPLIER_USER_FIELDS);

    // Privileged fields (`verified`, `isActive`, etc.) only honored for superAdmin.
    if (req.admin?.role === "superAdmin") {
      Object.assign(
        supplierData,
        pickFields(req.body, SUPPLIER_PRIVILEGED_FIELDS)
      );
    }

    // Remove empty strings for optional fields
    Object.keys(supplierData).forEach((key) => {
      if (supplierData[key] === "" || supplierData[key] === null) {
        if (!["name", "category", "email"].includes(key)) {
          delete supplierData[key];
        }
      }
    });

    // Convert lastVerifiedDate string to Date if provided. `lastVerifiedDate`
    // is in SUPPLIER_PRIVILEGED_FIELDS, so this only runs when the caller is
    // a superAdmin and actually included it on the body.
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

    // Auto-generate supplier number — NEVER accept from body.
    supplierData.supplierNumber = await generateSupplierNumber();

    const supplier = await Supplier.create(supplierData);

    res.status(201).json({
      success: true,
      message: "Supplier created successfully",
      data: supplier,
    });
  } catch (error) {
    console.error("Error creating supplier:", error);

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
 *
 * C-5: explicit allowlist replaces the previous `findByIdAndUpdate(id, req.body)`
 * mass-assignment. Privileged fields (`verified`, `isActive`, `internalNotes`,
 * `buyerMatchRecommendation`) are only honored when the caller is a superAdmin;
 * a regular admin's PUT silently strips them. `_id`, `createdAt`, `updatedAt`,
 * `__v`, and `supplierNumber` are never copied because they are not in either
 * allowlist.
 */
export const updateSupplier = async (req, res) => {
  try {
    const { id } = req.params;

    const update = pickFields(req.body, SUPPLIER_USER_FIELDS);
    if (req.admin?.role === "superAdmin") {
      Object.assign(update, pickFields(req.body, SUPPLIER_PRIVILEGED_FIELDS));
    }

    // String → Date for `lastVerifiedDate` (privileged, superAdmin-only above).
    if (update.lastVerifiedDate && typeof update.lastVerifiedDate === "string") {
      update.lastVerifiedDate = new Date(update.lastVerifiedDate);
    }

    const supplier = await Supplier.findByIdAndUpdate(id, update, {
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
 * Bulk upload suppliers from CSV/Excel file.
 * Expected column headers match the master supplier list exactly.
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
      try {
        rows = await readXlsxAsJson(filePath);
      } catch (err) {
        // M-11: surface oversize sheets as 400 instead of leaking a 500.
        if (err && err.code === "SHEET_TOO_LARGE") {
          if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
          return res.status(400).json({
            success: false,
            message: err.message,
          });
        }
        throw err;
      }
    } else {
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

    /**
     * Normalize column headers: lowercase, trim, convert spaces/hyphens/slashes
     * to underscores, strip all other special characters.
     * e.g. "Supplier Name" → "supplier_name"
     *      "State/Region"  → "state_region"
     *      "Certifications (ISO, 8a, etc.)" → "certifications_iso_8a_etc"
     */
    const normalizeKey = (key) => {
      if (!key) return key;
      return key
        .toString()
        .toLowerCase()
        .trim()
        .replace(/[\s\-\/]+/g, "_")
        .replace(/[^a-z0-9_]/g, "")
        .replace(/_+/g, "_")
        .replace(/^_|_$/g, "");
    };

    // Required normalized column names (contact_email is optional)
    const requiredFields = ["supplier_name", "category"];

    const errors = [];
    const suppliers = [];
    const skipped = [];

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    // Load existing emails and names from DB for duplicate check (by email if present, else by name)
    const existingEmails = new Set();
    const existingNames = new Set();
    const existingSuppliers = await Supplier.find({}, { email: 1, name: 1 }).lean();
    existingSuppliers.forEach((doc) => {
      if (doc.name) existingNames.add(doc.name.toString().trim().toLowerCase());
      if (doc.email) {
        doc.email
          .toString()
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e)
          .forEach((e) => existingEmails.add(e));
      }
    });

    const seenEmailsInFile = new Set();
    const seenNamesInFile = new Set();

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const rowNum = i + 2;

      // Normalize all keys in this row
      const nr = {};
      Object.keys(row).forEach((key) => {
        nr[normalizeKey(key)] = row[key];
      });

      // Check required fields
      const missingFields = requiredFields.filter(
        (field) => !nr[field] || !nr[field].toString().trim()
      );
      if (missingFields.length > 0) {
        const displayNames = {
          supplier_name: "Supplier Name",
          category: "Category",
        };
        errors.push({
          row: rowNum,
          message: `Missing required fields: ${missingFields.map((f) => displayNames[f] || f).join(", ")}`,
        });
        skipped.push({ row: rowNum, data: nr });
        continue;
      }

      // Contact email is optional. If present, can be comma-separated; validate each part.
      let contactEmailValue = "";
      if (nr.contact_email != null && nr.contact_email.toString().trim() !== "") {
        const parts = nr.contact_email.toString().split(",").map((p) => p.trim()).filter((p) => p);
        const invalid = parts.filter((p) => !emailRegex.test(p));
        if (invalid.length > 0) {
          errors.push({
            row: rowNum,
            message: `Invalid email format: ${invalid.join(", ")}`,
          });
          skipped.push({ row: rowNum, data: nr });
          continue;
        }
        contactEmailValue = parts.join(", ").toLowerCase();
      }

      const supplierName = nr.supplier_name.toString().trim();
      const nameKey = supplierName.toLowerCase();

      // Duplicate check: by email if at least one exists, else by name
      if (contactEmailValue) {
        const rowEmails = contactEmailValue
          .split(",")
          .map((e) => e.trim().toLowerCase())
          .filter((e) => e);
        const duplicateEmail = rowEmails.find(
          (e) => existingEmails.has(e) || seenEmailsInFile.has(e)
        );
        if (duplicateEmail) {
          errors.push({
            row: rowNum,
            message: `Duplicate: contact email already exists (${duplicateEmail})`,
          });
          skipped.push({ row: rowNum, data: nr });
          continue;
        }
        rowEmails.forEach((e) => seenEmailsInFile.add(e));
      } else {
        if (existingNames.has(nameKey) || seenNamesInFile.has(nameKey)) {
          errors.push({
            row: rowNum,
            message: `Duplicate: supplier name already exists (no contact email to match)`,
          });
          skipped.push({ row: rowNum, data: nr });
          continue;
        }
        seenNamesInFile.add(nameKey);
      }

      // Generate unique supplier number
      const supplierNumber = await generateSupplierNumber();

      // Build supplier object
      const supplierData = {
        supplierNumber,
        name: supplierName,
        category: nr.category.toString().trim(),
        email: contactEmailValue,
        subCategory: nr.sub_category ? nr.sub_category.toString().trim() : "",
        country: nr.country ? nr.country.toString().trim() : "",
        stateRegion: nr.state_region ? nr.state_region.toString().trim() : "",
        city: nr.city ? nr.city.toString().trim() : "",
        contactName: nr.contact_name ? nr.contact_name.toString().trim() : "",
        phone: nr.contact_phone ? nr.contact_phone.toString().trim() : "",
        website: nr.website ? nr.website.toString().trim() : "",
        certifications: nr.certifications_iso_8a_etc
          ? nr.certifications_iso_8a_etc.toString().split(",").map((c) => c.trim()).filter((c) => c)
          : [],
        diversityType: nr.diversity_type_mbe_wbe_vbe_etc
          ? nr.diversity_type_mbe_wbe_vbe_etc.toString().trim()
          : "",
        capabilities: nr.primary_products_services
          ? nr.primary_products_services.toString().split(",").map((c) => c.trim()).filter((c) => c)
          : [],
        minOrderQuantity: nr.min_order_quantity_moq
          ? nr.min_order_quantity_moq.toString().trim()
          : "",
        leadTime: nr.lead_time_days ? nr.lead_time_days.toString().trim() : "",
        annualCapacity: nr.annual_capacity_volume_notes
          ? nr.annual_capacity_volume_notes.toString().trim()
          : "",
        industry: nr.industry_construction_it_etc
          ? nr.industry_construction_it_etc.toString().trim()
          : "",
        businessVerification: nr.business_verification
          ? nr.business_verification.toString().trim()
          : "",
        riskFlags: nr.risk_flags_if_any ? nr.risk_flags_if_any.toString().trim() : "",
        dataSource: nr.data_source_link_or_note
          ? nr.data_source_link_or_note.toString().trim()
          : "",
        verified: nr.verified_yesno !== undefined
          ? nr.verified_yesno.toString().toLowerCase() === "yes" ||
            nr.verified_yesno.toString().toLowerCase() === "true" ||
            nr.verified_yesno.toString() === "1"
          : false,
        lastVerifiedDate: nr.last_verified_date
          ? new Date(nr.last_verified_date)
          : undefined,
        internalNotes: nr.internal_notes ? nr.internal_notes.toString().trim() : "",
        buyerMatchRecommendation: nr.buyer_match_recommendation
          ? nr.buyer_match_recommendation.toString().trim()
          : "",
        isActive: nr.status_active_in_review_rejected !== undefined
          ? nr.status_active_in_review_rejected.toString().toLowerCase() === "active" ||
            nr.status_active_in_review_rejected.toString().toLowerCase() === "true"
          : true,
      };

      suppliers.push(supplierData);
    }

    fs.unlinkSync(filePath);

    const duplicateCount = errors.filter(
      (e) => e.message && e.message.startsWith("Duplicate:")
    ).length;
    const otherErrorCount = errors.length - duplicateCount;

    if (suppliers.length === 0) {
      const messageParts = [];
      if (duplicateCount > 0) messageParts.push(`${duplicateCount} duplicate(s)`);
      if (otherErrorCount > 0) messageParts.push(`${otherErrorCount} other error(s)`);
      const message =
        messageParts.length > 0
          ? `No suppliers imported. ${messageParts.join(", ")}.`
          : "No valid suppliers found in file.";
      return res.status(400).json({
        success: false,
        message,
        errors,
        errorsDetails: errors,
        skipped: skipped.length,
        duplicateCount,
      });
    }

    const result = await Supplier.insertMany(suppliers, {
      ordered: false,
    }).catch((error) => {
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
        duplicateCount,
        errorsDetails: errors.length > 0 ? errors : undefined,
      },
    });
  } catch (error) {
    console.error("Error bulk uploading suppliers:", error);

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
      message: `Supplier ${supplier.isActive ? "activated" : "deactivated"} successfully`,
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
