// Load environment variables FIRST, before any other imports
import dotenv from "dotenv";
dotenv.config();

import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import { connectDB } from "./config/database.js";
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
import { handleWebhook } from "./controllers/customer/paymentController.js";

const app = express();
const PORT = process.env.PORT || 5000;

// Middleware
const allowedOrigins = [
  process.env.FRONTEND_URL || "http://localhost:3002",
  process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004",
  process.env.ADMIN_DASHBOARD_URL || "http://localhost:3003",
  "http://localhost:3000",
  "http://localhost:3001",
];

app.use(
  cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps or curl requests)
      if (!origin) return callback(null, true);

      // In development (or if NODE_ENV is not set to production), allow all localhost origins
      const isDevelopment = process.env.NODE_ENV !== "production";
      if (isDevelopment && origin.includes("localhost")) {
        return callback(null, true);
      }

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
  })
);

// Webhook route needs raw body, so we handle it before JSON parser
// Note: Stripe webhook route handles its own body parsing
app.post(
  "/api/payments/webhook",
  express.raw({ type: "application/json" }),
  handleWebhook
);

app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    message: "SupplyAI Backend API is running",
    timestamp: new Date().toISOString(),
  });
});

// API Routes
app.use("/api/requests", requestsRouter);
app.use("/api/matches", matchesRouter);
app.use("/api/payments", paymentsRouter);
app.use("/api/auth", authRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/feedback", feedbackRouter);
app.use("/api/admin/auth", adminAuthRouter);
app.use("/api/admin", adminRouter);
app.use("/api/managed-services", managedServicesRouter);
app.use("/api/admin/managed-services", adminManagedServicesRouter);
app.use("/api/admin/settings", settingsRouter);
app.use("/api/admin/plans", plansRouter);
app.use("/api/plans", publicPlansRouter);
app.use("/api/settings", publicSettingsRouter);
app.use("/api/categories", categoriesRouter);
app.use("/api/admin/categories", adminCategoriesRouter);
app.use("/api/admin/match-reports", matchReportsRouter);
app.use("/api/receipts", receiptsRouter);

// 404 handler
app.use((req, res) => {
  res.status(404).json({
    success: false,
    message: "Route not found",
  });
});

// Error handler
app.use((err, req, res, next) => {
  console.error("Error:", err);
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
      console.log(`🚀 Server running on port ${PORT}`);
      console.log(`📍 Health check: http://localhost:${PORT}/health`);
      console.log(`📍 API endpoint: http://localhost:${PORT}/api/requests`);
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();
