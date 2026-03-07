import express from "express";
import multer from "multer";
import { uploadDocument } from "../../controllers/common/uploadController.js";
import { authenticate } from "../../middleware/auth.js";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    // Create unique filename: timestamp-randomstring-originalname
    const timestamp = Date.now();
    const random = Math.random().toString(36).substring(2, 15);
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${timestamp}-${random}-${sanitizedName}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Only allow PDFs and images
  const allowedMimes = [
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
  ];

  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new Error(`File type ${file.mimetype} not allowed`), false);
  }
};

const upload = multer({
  storage,
  fileFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB max
  },
});

// POST /api/upload - Upload a single document
router.post("/", authenticate, upload.single("file"), uploadDocument);

export default router;
