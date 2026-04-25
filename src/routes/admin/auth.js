import express from "express";
import {
  loginAdmin,
  logoutAdmin,
  getCurrentAdmin,
  changeAdminPassword,
} from "../../controllers/admin/adminAuthController.js";
import { authenticateAdmin } from "../../middleware/adminAuth.js";
import { requireCsrf, issueCsrfHandler } from "../../middleware/csrf.js";

const router = express.Router();

// POST /api/admin/auth/login - Login admin
// No CSRF check on login itself: the caller is by definition unauthenticated
// at this point and the credentials are the proof of intent. The login
// response sets the `ad-csrf` cookie for use on subsequent mutations.
router.post("/login", loginAdmin);

// POST /api/admin/auth/logout - Logout admin
// CSRF protected: a logout forged from another origin would be a (mild)
// nuisance attack but it's still a state-changing operation.
router.post("/logout", authenticateAdmin, requireCsrf, logoutAdmin);

// GET /api/admin/auth/me - Get current admin
router.get("/me", authenticateAdmin, getCurrentAdmin);

// GET /api/admin/auth/csrf - Issue/refresh a CSRF token (M-6).
// Lets the frontend recover from a missing/expired `ad-csrf` cookie without
// forcing the admin to re-authenticate. Authentication is still required so
// only logged-in admins can mint tokens.
router.get("/csrf", authenticateAdmin, issueCsrfHandler);

// PUT /api/admin/auth/change-password - Change admin password
router.put(
  "/change-password",
  authenticateAdmin,
  requireCsrf,
  changeAdminPassword
);

export default router;

