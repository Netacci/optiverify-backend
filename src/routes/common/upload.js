import express from "express";
import multer from "multer";
import crypto from "crypto";
import fs from "fs";
import { uploadDocument } from "../../controllers/common/uploadController.js";
import { authenticate } from "../../middleware/auth.js";

const router = express.Router();

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/");
  },
  filename: (req, file, cb) => {
    // Plan ref: M-2 — replace Math.random with cryptographically random bytes.
    // Format: timestamp-randomhex-sanitizedOriginalName
    const timestamp = Date.now();
    const random = crypto.randomBytes(16).toString("hex");
    const sanitizedName = file.originalname.replace(/[^a-zA-Z0-9.-]/g, "_");
    cb(null, `${timestamp}-${random}-${sanitizedName}`);
  },
});

const fileFilter = (req, file, cb) => {
  // Plan ref: M-10 — reject SVG explicitly (stored-XSS vector) even if mime
  // mapping or extension would otherwise admit it.
  const ext = (file.originalname || "").toLowerCase();
  if (
    file.mimetype === "image/svg+xml" ||
    ext.endsWith(".svg") ||
    ext.endsWith(".svgz")
  ) {
    return cb(new Error("File type image/svg+xml not allowed"), false);
  }

  // Only allow PDFs and (raster) images
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

// Plan ref: M-10 — magic-byte validation. The mimetype reported by multer is
// taken from the upload's headers/extension and is fully client-controlled, so
// we must verify the actual file contents.
//
// We read the first 16 bytes after disk write (cheap; multer's disk storage
// has already finished by the time the route handler runs) and match against
// a small inline lookup table. No new dependency needed.
function validateMagic(buf, mimetype) {
  if (!buf || buf.length < 4) return false;

  switch (mimetype) {
    case "application/pdf":
      // %PDF-
      return (
        buf[0] === 0x25 &&
        buf[1] === 0x50 &&
        buf[2] === 0x44 &&
        buf[3] === 0x46 &&
        buf[4] === 0x2d
      );
    case "image/png":
      // 89 50 4E 47 0D 0A 1A 0A
      return (
        buf.length >= 8 &&
        buf[0] === 0x89 &&
        buf[1] === 0x50 &&
        buf[2] === 0x4e &&
        buf[3] === 0x47 &&
        buf[4] === 0x0d &&
        buf[5] === 0x0a &&
        buf[6] === 0x1a &&
        buf[7] === 0x0a
      );
    case "image/jpeg":
      // FF D8 FF
      return buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
    case "image/gif":
      // "GIF87a" or "GIF89a"
      return (
        buf.length >= 6 &&
        buf[0] === 0x47 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x38 &&
        (buf[4] === 0x37 || buf[4] === 0x39) &&
        buf[5] === 0x61
      );
    case "image/webp":
      // "RIFF" .... "WEBP"
      return (
        buf.length >= 12 &&
        buf[0] === 0x52 &&
        buf[1] === 0x49 &&
        buf[2] === 0x46 &&
        buf[3] === 0x46 &&
        buf[8] === 0x57 &&
        buf[9] === 0x45 &&
        buf[10] === 0x42 &&
        buf[11] === 0x50
      );
    default:
      return false;
  }
}

function readFirstBytes(filePath, n) {
  const fd = fs.openSync(filePath, "r");
  try {
    const buf = Buffer.alloc(n);
    const bytesRead = fs.readSync(fd, buf, 0, n, 0);
    return buf.slice(0, bytesRead);
  } finally {
    fs.closeSync(fd);
  }
}

// POST /api/upload - Upload a single document
router.post(
  "/",
  authenticate,
  upload.single("file"),
  (req, res, next) => {
    // Magic-byte gate. Runs after multer has written the file to disk.
    if (!req.file) return next();
    try {
      const head = readFirstBytes(req.file.path, 16);
      if (!validateMagic(head, req.file.mimetype)) {
        try {
          fs.unlinkSync(req.file.path);
        } catch (_) {
          // best-effort cleanup
        }
        return res.status(400).json({
          success: false,
          message: "File content does not match its declared type",
        });
      }
      return next();
    } catch (err) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (_) {
        // best-effort cleanup
      }
      return res.status(400).json({
        success: false,
        message: "Failed to validate uploaded file",
      });
    }
  },
  uploadDocument,
);

export default router;
