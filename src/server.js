// Load environment variables FIRST, before any other imports
import dotenv from "dotenv";
dotenv.config();

// Plan ref: C-2, H-6 — fail-closed startup secret validation.
// Run BEFORE any other module is imported that might read these vars at
// import time, so a missing/insecure value causes the process to exit early
// in production.
import { validateEnv } from "./config/validateEnv.js";
validateEnv();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import { connectDB } from "./config/database.js";
import logger from "./utils/logger.js";
import { requestId } from "./middleware/requestId.js";
import requestsRouter from "./routes/customer/requests.js";
import matchesRouter from "./routes/customer/matches.js";
import paymentsRouter from "./routes/customer/payments.js";
import authRouter from "./routes/common/auth.js";
import dashboardRouter from "./routes/customer/dashboard.js";
import feedbackRouter from "./routes/customer/feedback.js";
import adminRouter from "./routes/admin/admin.js";
import adminAuthRouter from "./routes/admin/auth.js";
import managedServicesRouter from "./routes/customer/managedServices.js";
import adminManagedServicesRouter from "./routes/admin/managedServices.js";
import settingsRouter from "./routes/admin/settings.js";
import publicSettingsRouter from "./routes/common/settings.js";
import plansRouter from "./routes/admin/plans.js";
import publicPlansRouter from "./routes/common/plans.js";
import categoriesRouter from "./routes/common/categories.js";
import adminCategoriesRouter from "./routes/admin/categories.js";
import matchReportsRouter from "./routes/admin/matchReports.js";
import receiptsRouter from "./routes/customer/receipts.js";
import contactRouter from "./routes/common/contact.js";
import uploadRouter from "./routes/common/upload.js";
import filesRouter from "./routes/common/files.js";
import { handleWebhook } from "./controllers/customer/paymentController.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Plan ref: L-1 — security headers. CSP is intentionally disabled here; this
// is an API surface, and CSP belongs on the Next.js frontends that actually
// render HTML.
app.use(helmet({ contentSecurityPolicy: false }));

// Plan ref: M-8, L-7 — request correlation IDs. Mounted before routes so that
// every downstream handler has access to `req.requestId` and `req.log`, and
// every response carries an `X-Request-Id` header.
app.use(requestId);

// Middleware
// Parse ALLOWED_ORIGINS from environment variable (comma-separated)
// Falls back to individual URL env vars for backward compatibility
const parseAllowedOrigins = () => {
  const origins = [];

  // If ALLOWED_ORIGINS is set, use it (comma-separated list)
  if (process.env.ALLOWED_ORIGINS) {
    origins.push(
      ...process.env.ALLOWED_ORIGINS.split(",").map((origin) => origin.trim()),
    );
  } else {
    // Fallback to individual URL environment variables
    if (process.env.FRONTEND_URL) origins.push(process.env.FRONTEND_URL);
    if (process.env.CUSTOMER_DASHBOARD_URL)
      origins.push(process.env.CUSTOMER_DASHBOARD_URL);
    if (process.env.ADMIN_DASHBOARD_URL)
      origins.push(process.env.ADMIN_DASHBOARD_URL);
  }

  // Only add localhost defaults in development mode
  // In production, origins must be explicitly configured
  const isDevelopment = process.env.NODE_ENV !== "production";
  if (origins.length === 0 && isDevelopment) {
    console.warn(
      "⚠️  No CORS origins configured. Using localhost defaults for development.",
    );
    origins.push(
      "http://localhost:3002", // Frontend
      "http://localhost:3004", // Customer Dashboard
      "http://localhost:3003", // Admin Dashboard
      "http://localhost:3000",
      "http://localhost:3001",
    );
  } else if (origins.length === 0 && !isDevelopment) {
    throw new Error(
      "❌ CORS origins must be configured in production. Please set ALLOWED_ORIGINS or individual URL environment variables.",
    );
  }

  return origins;
};

const allowedOrigins = parseAllowedOrigins();

// Log allowed origins for debugging (only in development)
if (process.env.NODE_ENV !== "production") {
  console.log("🌐 Allowed CORS origins:", allowedOrigins);
}

// Plan ref: H-11 — strict CORS allowlist always. The previous "if dev and
// origin includes 'localhost', allow" branch is removed: it permitted hosts
// like `http://localhost.attacker.com` whenever NODE_ENV drifted from
// production (e.g. preview deploys), which combined with credentials:true
// would enable CSRF + cookie theft. Only the explicit allowlist is trusted.
app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      if (allowedOrigins.indexOf(origin) !== -1) {
        callback(null, true);
      } else {
        console.warn(`CORS blocked origin: ${origin}`);
        callback(new Error("Not allowed by CORS"));
      }
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
    // Plan ref: L-8 — preflight cache.
    maxAge: 600,
  }),
);

// Plan ref: H-1 — per-route rate limiters. Tighter buckets where brute-force
// or cost-amplification matters; a generous general bucket elsewhere.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});
const contactLimiter = rateLimit({
  windowMs: 60 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});
// aiLimiter (5/min) lives inline in routes/customer/requests.js where it's
// applied per-route to /:id/match and /:id/generate-match only. Mounting it
// at the router root caused unrelated GETs (e.g. /:id/details) to share the
// AI bucket and throttle real users.
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests" },
});

// Webhook route needs raw body, so we handle it before JSON parser
// Note: Stripe webhook route handles its own body parsing
app.post(
  "/api/payments/webhook",
  webhookLimiter,
  express.raw({ type: "application/json" }),
  handleWebhook,
);

// Plan ref: H-10 — tighten body-parser limits from 50mb (DoS amplifier) to
// 256kb. The webhook above uses its own raw parser and is unaffected. File
// upload routes use multer's own limits (5MB) and are also unaffected.
app.use(express.json({ limit: "256kb" }));
app.use(express.urlencoded({ extended: true, limit: "256kb" }));

// Plan ref: H-6 — pass COOKIE_SECRET so signed cookies actually verify.
// validateEnv() above guarantees this is set + non-default in production.
app.use(cookieParser(process.env.COOKIE_SECRET));

// Plan ref: C-6, L-6 — replaces public `app.use("/uploads", express.static)`
// with an authentication-gated route that adds Content-Disposition: attachment
// and X-Content-Type-Options: nosniff.
//
// BREAKING: any URL of the form `/uploads/<name>` previously stored in the
// database (e.g. uploadController.js returns `url: "/uploads/<filename>"`)
// will now 404. A migration is required to rewrite stored values from
// `/uploads/<name>` to `/api/files/<name>`.
app.use("/api/files", filesRouter);

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "SupplyAI Backend API is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/upload", uploadRouter);
// aiLimiter is applied PER-ROUTE inside requests.js (only
// on /:id/match and /:id/generate-match, the actual AI fan-out endpoints).
// At the router level we apply the generous generalLimiter so non-AI
// endpoints (GET /:id/details, POST create, unlock) get a sane 300/15min
// ceiling rather than sharing the AI bucket.
app.use("/api/requests", generalLimiter, requestsRouter);
app.use("/api/matches", matchesRouter);
app.use("/api/payments", generalLimiter, paymentsRouter);
app.use("/api/auth", authLimiter, authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/admin/auth", authLimiter, adminAuthRouter);
app.use("/api/admin", adminRouter);
app.use("/api/managed-services", generalLimiter, managedServicesRouter);
app.use("/api/admin/managed-services", adminManagedServicesRouter);
app.use("/api/admin/settings", settingsRouter);
app.use("/api/admin/plans", plansRouter);
app.use("/api/plans", publicPlansRouter);
app.use("/api/settings", publicSettingsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/admin/categories", adminCategoriesRouter);
app.use("/api/admin/match-reports", matchReportsRouter);
app.use("/api/transactions", receiptsRouter);
app.use("/api/contact", contactLimiter, contactRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  // Plan ref: M-8 — structured + redacted error logging. Prefer the
  // request-scoped child logger (carries reqId) when available; fall back to
  // the module logger if requestId middleware didn't run for some reason.
  req.log?.error?.(err, "request error") || logger.error(err, "request error");
  res.status(500).json({
    success: false,
    message: "Internal server error",
    error: process.env.NODE_ENV === "development" ? err.message : undefined,
  });
});

// Start server
const startServer = async () => {
  try {
    // Connect to MongoDB
    await connectDB();

    // Start Express server
    app.listen(PORT, () => {
      logger.info(
        {
          port: PORT,
          healthCheck: `http://localhost:${PORT}/health`,
          apiEndpoint: `http://localhost:${PORT}/api/requests`,
        },
        "Server running",
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
