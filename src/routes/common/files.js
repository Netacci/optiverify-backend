// Auth-gated file serving — replaces the unauth `app.use("/uploads", static)`.
//
// Plan reference: C-6, L-6.
//
// Today this is just an authentication gate (any logged-in user can fetch any
// upload by name). That is strictly stronger than the previous public static
// directory, but it is NOT a per-owner ACL.
//
// TODO(C-6 follow-up): add an Upload model with ownerId and check
//   `upload.ownerId === req.user._id` before sendFile, or move to S3 with
//   short-lived signed URLs.

import express from "express";
import path from "path";
import fs from "fs";
import { authenticate } from "../../middleware/auth.js";

const router = express.Router();
const UPLOADS_DIR = path.resolve("uploads");

router.get("/:filename", authenticate, (req, res) => {
  const name = req.params.filename;

  // Whitelist: only safe filename characters; reject any traversal sequence.
  if (!/^[A-Za-z0-9_.-]+$/.test(name) || name.includes("..")) {
    return res.status(400).end();
  }

  const full = path.join(UPLOADS_DIR, name);

  // Belt-and-suspenders path traversal guard: resolved path must live inside
  // the uploads dir.
  if (!full.startsWith(UPLOADS_DIR + path.sep)) {
    return res.status(400).end();
  }

  if (!fs.existsSync(full)) {
    return res.status(404).end();
  }

  // Force download semantics + stop browsers from MIME-sniffing into something
  // executable (mitigates stored-XSS via uploaded HTML/SVG polyglots).
  res.setHeader("Content-Disposition", `attachment; filename="${name}"`);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.sendFile(full);
});

export default router;
