import ManagedService from "../../models/customer/ManagedService.js";
import SystemSettings from "../../models/admin/SystemSettings.js";
import {
  enrichManagedService,
  enrichManagedServices,
} from "../../utils/managedServiceUtils.js";
import Category from "../../models/admin/Category.js";
import User from "../../models/common/User.js";
import Payment from "../../models/customer/Payment.js";
import {
  sendEmail,
  sendManagedServiceReceiptEmail,
} from "../../services/emailService.js";
import { generateToken as generateTokenService } from "../../services/tokenService.js";
import Stripe from "stripe";

// M-14 — Anonymous public-form abuse mitigation (defense-in-depth alongside
// the express-rate-limit middleware applied at server.js). Mirrors the layer
// added to requestController.js so the two public endpoints behave the same.
//
// Layers (in order):
//   1. Honeypot field — `req.body.website_url`. Real users leave the
//      offscreen-positioned input blank; bots tripping it get silent-drop.
//   2. Submission-window heuristic — `req.body.form_render_ts`. If the form
//      was submitted in <3s (or no timestamp present), treat as scripted.
//   3. Per-IP creation cap (anonymous only) — 10 creates / hour rolling.
//
// All three trigger SILENT-DROP: respond 200 OK with {success:true} so a bot
// can't tell whether it actually got in. Operators monitor the `console.warn`
// log lines for false positives. A future CAPTCHA (hCaptcha / Cloudflare
// Turnstile) layer can replace these heuristics.
const MS_ANON_IP_CAP = 10; // creates per window
const MS_ANON_IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling
const msAnonIpCreateCounts = new Map(); // ip -> { count, resetAt }

function sweepExpiredMsAnonIpCounts(now) {
  // Best-effort cleanup — no setInterval, runs on each anonymous create.
  for (const [ip, entry] of msAnonIpCreateCounts) {
    if (entry.resetAt <= now) msAnonIpCreateCounts.delete(ip);
  }
}

function getClientIpMs(req) {
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// M-9 — Mass-assignment guard for ManagedService.
// Buyer-controlled fields. Anything not in this list (notably: userId,
// serviceFee*, savingsFee*, status, stage, adminNotes, assignedAdmin,
// finalReport, suppliers, _id, createdAt, updatedAt, __v) must NEVER be
// taken from req.body on customer-facing routes — it is server-set only.
// Field names mirror the schema in src/models/customer/ManagedService.js.
const MS_USER_FIELDS = [
  "itemName",
  "category",
  "subCategory",
  "subcategory", // legacy alias the schema still accepts
  "quantity",
  "description",
  "estimatedSpendRange",
  "urgency",
  "complianceLevel",
  "deliveryLocation",
  "internalDeadline",
  // Legacy aliases preserved by the schema (kept editable for back-compat)
  "specifications",
  "budget",
  "deadline",
];

// Admin-only fields. Listed for documentation/grep value. Customer routes in
// THIS file must never accept these from req.body. Admin endpoints live in a
// different controller; if any code below appears to set these from req.body,
// it should be flagged as _DEPRECATED.
// eslint-disable-next-line no-unused-vars
const MS_ADMIN_FIELDS = [
  "status",
  "stage",
  "adminNotes",
  "assignedAdmin",
  "serviceFeeAmount",
  "serviceFeeStatus",
  "serviceFeePaymentId",
  "serviceFeePaidAt",
  "serviceFeeEmailSentAt",
  "originalPrice",
  "negotiatedPrice",
  "savingsAmount",
  "savingsFeeAmount",
  "savingsFeePercentage",
  "savingsFeeStatus",
  "savingsFeePaymentId",
  "savingsFeePaidAt",
  "suppliers",
  "finalReport",
];

function pickFields(body, fields) {
  const out = {};
  if (!body || typeof body !== "object") return out;
  for (const k of fields) {
    if (body[k] !== undefined) out[k] = body[k];
  }
  return out;
}

// C-7 + H-3 — Ownership check for managed service records. Returns true if
// the authenticated user (req.user) owns the record. When req.user is unset,
// returns false (caller decides whether anonymous access is acceptable for
// the route — most routes here MUST require auth).
// TODO(H-7): drop email fallback once userId is required on every record.
function userOwnsManagedService(reqUser, ms) {
  if (!reqUser || !ms) return false;
  const ownsByUserId =
    ms.userId && reqUser._id && ms.userId.equals?.(reqUser._id);
  const ownsByEmail =
    !ms.userId &&
    ms.email &&
    reqUser.email &&
    ms.email.toLowerCase().trim() ===
      reqUser.email.toLowerCase().trim();
  return Boolean(ownsByUserId || ownsByEmail);
}

/**
 * Calculate managed service price based on category grade and urgency
 * Uses settings from database for grade prices and urgency fees
 */
const calculateManagedServicePrice = (categoryGrade, urgency, settings) => {
  // Convert Map to object for easier access
  const gradePrices = settings?.gradePrices
    ? Object.fromEntries(
        settings.gradePrices instanceof Map
          ? settings.gradePrices
          : new Map(Object.entries(settings.gradePrices))
      )
    : { low: 750, medium: 1500, high: 2500 };

  const urgencyFees = settings?.urgencyFees
    ? Object.fromEntries(
        settings.urgencyFees instanceof Map
          ? settings.urgencyFees
          : new Map(Object.entries(settings.urgencyFees))
      )
    : {
        standard: { fee: 0, duration: "5-7 days" },
        expedited: { fee: 500, duration: "2-3 days" },
        emergency: { fee: 1000, duration: "24-48 hrs" },
      };

  // Base price from category grade
  const basePrice = gradePrices[categoryGrade] || gradePrices.medium || 1500;

  // Urgency fees (extract fee from object if it's an object, otherwise use as number for backward compatibility)
  const urgencyData = urgencyFees[urgency] ||
    urgencyFees.standard || { fee: 0, duration: "" };
  const urgencyFee =
    typeof urgencyData === "object" ? urgencyData.fee : urgencyData;

  const totalPrice = basePrice + urgencyFee;

  return {
    basePrice,
    urgencyFee,
    totalPrice,
    breakdown: {
      categoryGrade,
      urgency,
    },
  };
};

// Initialize Stripe
const getStripeInstance = () => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (
    !stripeKey ||
    stripeKey.includes("dummy") ||
    stripeKey === "sk_test_dummy_key_replace_with_real_key"
  ) {
    console.warn(
      "⚠️ Stripe key not configured - payment features will be limited"
    );
    return null;
  }
  try {
    return new Stripe(stripeKey, {
      apiVersion: "2024-12-18.acacia",
    });
  } catch (error) {
    console.error("Failed to initialize Stripe:", error);
    return null;
  }
};

const stripe = getStripeInstance();

/**
 * Initiate a Managed Service Request
 * Steps:
 * 1. Get category grade and calculate price
 * 2. Create ManagedService record with 'pending_payment' status
 * 3. Return ID and Fee Amount for frontend to initiate Stripe payment
 */
export const initiateRequest = async (req, res) => {
  try {
    // M-9 — Only allow whitelisted user fields from req.body. Admin/payment
    // fields (serviceFeeAmount, status, stage, etc.) are NEVER trusted from
    // the client; they are derived server-side from category + settings or
    // hard-coded for the initial state below.
    const userFields = pickFields(req.body, MS_USER_FIELDS);
    // Normalize subcategory alias (some clients send `subcategory` lowercase)
    const subCategory =
      userFields.subCategory ?? userFields.subcategory ?? undefined;

    const user = req.user; // Authenticated user (route uses authenticate)

    // Validate required fields
    if (
      !userFields.itemName ||
      !userFields.category ||
      !userFields.quantity ||
      !userFields.description ||
      !userFields.estimatedSpendRange ||
      !userFields.urgency ||
      !userFields.complianceLevel ||
      !userFields.deliveryLocation
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item name, category, quantity, description, estimated spend range, urgency, compliance level, and delivery location are required",
      });
    }

    // Get category to find grade
    const categoryDoc = await Category.findOne({
      name: userFields.category,
      isActive: true,
    });
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid category selected",
      });
    }

    // Get settings for pricing calculation
    let settings = await SystemSettings.findOne({ key: "pricing_config" });
    if (!settings) {
      settings = await SystemSettings.create({
        key: "pricing_config",
        savingsFeePercentage: 8,
      });
    }

    // Calculate price based on category grade and urgency. Server is the only
    // source of truth for serviceFeeAmount; never read it from req.body.
    const priceCalculation = calculateManagedServicePrice(
      categoryDoc.grade,
      userFields.urgency,
      settings
    );

    // Create the request record. userId/email come from req.user (server-side
    // identity); status + stage are server-set initial values.
    const request = await ManagedService.create({
      userId: user._id,
      email: user.email,
      itemName: userFields.itemName,
      category: userFields.category,
      subCategory: subCategory || undefined,
      quantity: userFields.quantity,
      description: userFields.description,
      estimatedSpendRange: userFields.estimatedSpendRange,
      urgency: userFields.urgency,
      complianceLevel: userFields.complianceLevel,
      deliveryLocation: userFields.deliveryLocation,
      internalDeadline: userFields.internalDeadline
        ? new Date(userFields.internalDeadline)
        : undefined,
      // Legacy fields (map from new fields if not provided)
      specifications: userFields.specifications || userFields.description,
      budget: userFields.budget || userFields.estimatedSpendRange,
      deadline:
        userFields.deadline ||
        (userFields.internalDeadline
          ? new Date(userFields.internalDeadline)
              .toISOString()
              .split("T")[0]
          : undefined),
      serviceFeeAmount: priceCalculation.totalPrice,
      savingsFeePercentage: settings.savingsFeePercentage, // Lock in the % at time of creation
      status: "pending_payment",
      stage: "payment_pending",
    });

    res.status(201).json({
      success: true,
      data: {
        requestId: request._id,
        serviceFeeAmount: request.serviceFeeAmount,
        savingsFeePercentage: request.savingsFeePercentage,
        priceBreakdown: priceCalculation.breakdown,
      },
    });
  } catch (error) {
    console.error("Error initiating managed service:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get User's Managed Service Requests
 */
export const getUserRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    // Find managed services by userId OR by email (for cases where userId wasn't set during payment)
    const userEmail = req.user.email.toLowerCase().trim();

    console.log(
      `[getUserRequests] Looking for managed services for user: ${req.user._id}, email: ${userEmail}`
    );

    // First, try to link any managed services by email that don't have userId set
    // Use exact case-insensitive match
    const updateResult = await ManagedService.updateMany(
      {
        email: {
          $regex: new RegExp(
            `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        },
        $or: [
          { userId: { $exists: false } },
          { userId: null },
          { userId: { $ne: req.user._id } },
        ],
      },
      {
        $set: { userId: req.user._id },
      }
    );

    console.log(
      `[getUserRequests] Linked ${updateResult.modifiedCount} managed service(s) to user ${req.user._id}`
    );

    // Now query for managed services - use exact email match (case-insensitive)
    const query = {
      $or: [
        { userId: req.user._id },
        {
          email: {
            $regex: new RegExp(
              `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        },
      ],
    };

    console.log(`[getUserRequests] Query:`, JSON.stringify(query, null, 2));

    const [requests, total] = await Promise.all([
      ManagedService.find(query)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ManagedService.countDocuments(query),
    ]);

    console.log(
      `[getUserRequests] Found ${requests.length} managed service(s) for user ${req.user._id}`
    );

    // Enrich requests with days left calculation
    const enrichedRequests = await enrichManagedServices(requests);

    res.json({
      success: true,
      data: enrichedRequests, // Frontend expects array directly
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    });
  } catch (error) {
    console.error("Error getting managed requests:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Public endpoint: Initiate a Managed Service Request (no auth required)
 * For website submissions before user registration
 */
export const initiatePublicRequest = async (req, res) => {
  try {
    // M-14 — Honeypot check. Bots tend to fill every visible field; this
    // input is hidden via offscreen CSS so a real user leaves it blank.
    if (
      typeof req.body?.website_url === "string" &&
      req.body.website_url.trim() !== ""
    ) {
      console.warn(
        `[initiatePublicRequest][M-14] Honeypot tripped from ip=${getClientIpMs(req)} — silent-drop`
      );
      return res.status(200).json({ success: true });
    }

    // M-14 — Submission-window heuristic. Frontend stamps form_render_ts at
    // mount; <3s means scripted submission. Absent timestamp is also bot.
    const m14RenderTs = Number(req.body?.form_render_ts);
    const m14Now = Date.now();
    if (!Number.isFinite(m14RenderTs) || m14Now - m14RenderTs < 3000) {
      console.warn(
        `[initiatePublicRequest][M-14] Submission-window heuristic tripped (renderTs=${req.body?.form_render_ts}, dt=${Number.isFinite(m14RenderTs) ? m14Now - m14RenderTs : "n/a"}ms) from ip=${getClientIpMs(req)} — silent-drop`
      );
      return res.status(200).json({ success: true });
    }

    // M-14 — Per-IP creation cap for anonymous traffic. This endpoint is
    // public (no auth required), so req.user is generally unset; gate
    // anyway to keep behavior consistent with requestController.
    if (!req.user) {
      sweepExpiredMsAnonIpCounts(m14Now);
      const m14Ip = getClientIpMs(req);
      const m14Entry = msAnonIpCreateCounts.get(m14Ip);
      if (m14Entry && m14Entry.resetAt > m14Now) {
        if (m14Entry.count >= MS_ANON_IP_CAP) {
          console.warn(
            `[initiatePublicRequest][M-14] Per-IP anon cap exceeded (${m14Entry.count}/${MS_ANON_IP_CAP}) from ip=${m14Ip} — silent-drop`
          );
          return res.status(200).json({ success: true });
        }
        m14Entry.count += 1;
      } else {
        msAnonIpCreateCounts.set(m14Ip, {
          count: 1,
          resetAt: m14Now + MS_ANON_IP_WINDOW_MS,
        });
      }
    }

    // M-5 — This is a CREATE-only endpoint. We accept buyer-supplied email
    // for new records but MUST NOT look up an existing record by email and
    // mutate it (would let an attacker hijack pending requests by knowing
    // someone else's email). All editing of existing records happens through
    // authenticated routes that resolve req.user.
    //
    // M-9 — Only whitelisted user-controlled fields. Server controls
    // serviceFeeAmount, status, stage, savingsFeePercentage, userId.
    const userFields = pickFields(req.body, MS_USER_FIELDS);
    const email = req.body?.email;
    const subCategory =
      userFields.subCategory ?? userFields.subcategory ?? undefined;

    // Validate email
    if (!email || !email.trim()) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Validate required fields
    if (
      !userFields.itemName ||
      !userFields.category ||
      !userFields.quantity ||
      !userFields.description ||
      !userFields.estimatedSpendRange ||
      !userFields.urgency ||
      !userFields.complianceLevel ||
      !userFields.deliveryLocation
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item name, category, quantity, description, estimated spend range, urgency, compliance level, and delivery location are required",
      });
    }

    // Get category to find grade
    const categoryDoc = await Category.findOne({
      name: userFields.category,
      isActive: true,
    });
    if (!categoryDoc) {
      return res.status(400).json({
        success: false,
        message: "Invalid category selected",
      });
    }

    // Get settings for pricing calculation
    let settings = await SystemSettings.findOne({ key: "pricing_config" });
    if (!settings) {
      settings = await SystemSettings.create({
        key: "pricing_config",
        savingsFeePercentage: 8,
      });
    }

    // Calculate price based on category grade and urgency. Server-derived only.
    const priceCalculation = calculateManagedServicePrice(
      categoryDoc.grade,
      userFields.urgency,
      settings
    );

    // Check if user exists with this email
    const existingUser = await User.findOne({
      email: email.trim().toLowerCase(),
    });

    // If user exists, they should submit from their dashboard, not the public form
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message:
          "An account with this email already exists. Please log in to your dashboard to submit a managed service request.",
        code: "USER_EXISTS",
        redirectUrl: `${
          process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
        }/login`,
      });
    }

    // Create the request record (userId will be null if user doesn't exist yet)
    const request = await ManagedService.create({
      userId: null, // Always null for public submissions
      email: email.trim().toLowerCase(),
      itemName: userFields.itemName,
      category: userFields.category,
      subCategory: subCategory || undefined,
      quantity: userFields.quantity,
      description: userFields.description,
      estimatedSpendRange: userFields.estimatedSpendRange,
      urgency: userFields.urgency,
      complianceLevel: userFields.complianceLevel,
      deliveryLocation: userFields.deliveryLocation,
      internalDeadline: userFields.internalDeadline
        ? new Date(userFields.internalDeadline)
        : undefined,
      // Legacy fields (map from new fields if not provided)
      specifications: userFields.specifications || userFields.description,
      budget: userFields.budget || userFields.estimatedSpendRange,
      deadline:
        userFields.deadline ||
        (userFields.internalDeadline
          ? new Date(userFields.internalDeadline)
              .toISOString()
              .split("T")[0]
          : undefined),
      serviceFeeAmount: priceCalculation.totalPrice,
      savingsFeePercentage: settings.savingsFeePercentage,
      status: "pending_payment",
      stage: "payment_pending",
    });

    res.status(201).json({
      success: true,
      data: {
        requestId: request._id,
        serviceFeeAmount: request.serviceFeeAmount,
        savingsFeePercentage: request.savingsFeePercentage,
        priceBreakdown: priceCalculation.breakdown,
      },
    });
  } catch (error) {
    console.error("Error initiating public managed service:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Create Stripe checkout session for savings fee payment
 */
export const createSavingsFeePaymentSession = async (req, res) => {
  try {
    const requestId = req.params.id; // Get from URL params
    const user = req.user; // Authenticated user (route uses authenticate)

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
      });
    }

    // C-7 + H-3 — Look up the DB record FIRST, then verify ownership before
    // anything else. amount and customer_email are derived from the DB record
    // and the authenticated user — never from req.body. Any req.body.amount /
    // req.body.email passed by the client is silently ignored.
    const request = await ManagedService.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Managed service request not found",
      });
    }

    // TODO(H-7): drop email fallback once userId is required.
    if (!userOwnsManagedService(user, request)) {
      console.warn(
        `[createSavingsFeePaymentSession] Ownership check FAILED for user ${user?._id} on managed service ${requestId}`
      );
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    // Check if savings fee is applicable
    if (!request.savingsAmount || request.savingsAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "No savings fee applicable for this request",
      });
    }

    // Server-derived amount (cents). Never trust req.body.amount.
    if (
      typeof request.savingsFeeAmount !== "number" ||
      !(request.savingsFeeAmount > 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Savings fee amount is not set on this request",
      });
    }
    const unitAmountCents = Math.round(request.savingsFeeAmount * 100);

    // Check if already paid
    if (request.savingsFeeStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "Savings fee has already been paid",
      });
    }

    // Check if Stripe is available
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: "Payment processing is currently unavailable",
      });
    }

    // Server-derived customer_email — auth user wins, fall back to record.
    const serverDerivedEmail = (user.email || request.email || "")
      .toLowerCase()
      .trim();

    // Create Stripe checkout session for savings fee
    const sessionParams = {
      payment_method_types: ["card"],
      mode: "payment",
      success_url: `${
        process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
      }/managed-services/${requestId}?payment=success`,
      cancel_url: `${
        process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
      }/managed-services/${requestId}?canceled=true`,
      client_reference_id: requestId.toString(),
      customer_email: serverDerivedEmail,
      metadata: {
        requestId: requestId.toString(),
        type: "managed_service_savings_fee",
        paymentType: "savings_fee",
        // Server-derived ownership/identity — never read from req.body.
        userIsVerified: user.isVerified ? "true" : "false",
        userId: user._id.toString(),
        email: serverDerivedEmail,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Managed Sourcing Savings Fee",
              description: `Savings fee (${
                request.savingsFeePercentage
              }% of $${request.savingsAmount.toFixed(2)} savings) for ${
                request.category
              } sourcing request`,
            },
            unit_amount: unitAmountCents, // Server-derived from DB
          },
          quantity: 1,
        },
      ],
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Store payment session ID
    request.savingsFeePaymentId = session.id;
    await request.save();

    res.json({
      success: true,
      message: "Payment session created",
      data: {
        sessionId: session.id,
        url: session.url,
        requestId,
      },
    });
  } catch (error) {
    console.error("Error creating savings fee payment session:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Create Stripe checkout session for managed service payment
 */
export const createPaymentSession = async (req, res) => {
  try {
    // C-7 + H-3 — DO NOT trust req.body.amount, req.body.email, or
    // req.body.userId. Server derives all three from the DB record and the
    // authenticated user. requestId is allowed from req.body because this
    // route also serves the public payment page (optionalAuth) where the
    // record was just created via /public/initiate.
    const { requestId } = req.body;
    const clientSuppliedEmail = req.body?.email; // accepted only on unauth path, see below

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
      });
    }

    // C-7 — Look up the DB record FIRST so all downstream values come from it.
    const request = await ManagedService.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Managed service request not found",
      });
    }

    // M-5 — Branch on req.user. When authenticated, ownership MUST match.
    // When unauthenticated (public payment page after /public/initiate),
    // we permit completing the checkout but never let the client mutate
    // amount or override the record's email.
    if (req.user) {
      // TODO(H-7): drop email fallback once userId is required.
      if (!userOwnsManagedService(req.user, request)) {
        console.warn(
          `[createPaymentSession] Ownership check FAILED for user ${req.user._id} on managed service ${requestId}`
        );
        return res.status(403).json({
          success: false,
          message: "Forbidden",
        });
      }
    } else {
      // Unauthenticated public flow: only allow if record has no userId yet
      // (i.e. it really is a public/intake record). If it's already bound to
      // a user, require auth — prevents anonymous attackers from initiating
      // payment on someone else's account-bound request.
      if (request.userId) {
        return res.status(401).json({
          success: false,
          message: "Authentication required to pay for this request",
        });
      }
    }

    // Server-derived amount: ALWAYS read from DB. Any req.body.amount is
    // silently ignored. unit_amount is in cents per Stripe API.
    if (
      typeof request.serviceFeeAmount !== "number" ||
      !(request.serviceFeeAmount > 0)
    ) {
      return res.status(400).json({
        success: false,
        message: "Service fee amount is not set on this request",
      });
    }
    const unitAmountCents = Math.round(request.serviceFeeAmount * 100);

    // Check if already paid
    if (request.serviceFeeStatus === "paid") {
      return res.status(400).json({
        success: false,
        message: "This request has already been paid",
      });
    }

    // Check if Stripe is available
    if (!stripe) {
      return res.status(503).json({
        success: false,
        message: "Payment processing is currently unavailable",
      });
    }

    // C-7 — effectiveUser comes ONLY from req.user (auth middleware). We no
    // longer accept body.userId as a fallback — that was an unauthenticated
    // identity claim and is exactly the C-7 vector. Unauth path stays unauth.
    let effectiveUser = req.user || null;
    const isAuthenticated = !!effectiveUser;

    // For the unauth flow we still need an email for Stripe's receipt; use
    // the record's email (set at /public/initiate time). Validate the
    // client-supplied email only as a sanity check that the buyer is on the
    // right page; never write it into the record on the unauth path.
    if (!isAuthenticated) {
      if (!clientSuppliedEmail || !clientSuppliedEmail.trim()) {
        return res.status(400).json({
          success: false,
          message: "Email is required",
        });
      }
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(clientSuppliedEmail.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address",
        });
      }
    }

    // Server-derived customer_email — never trust req.body on the auth path.
    const effectiveEmail = (
      isAuthenticated ? effectiveUser.email : request.email || ""
    )
      .toLowerCase()
      .trim();

    console.log(
      `[createPaymentSession] requestId=${requestId}, authenticated=${isAuthenticated}, effectiveEmail=${effectiveEmail}`
    );

    // Only check for existing users if user is NOT authenticated. We use the
    // RECORD's email (server-derived) for this check, not the client's, so an
    // attacker can't probe by guessing emails.
    if (!isAuthenticated) {
      const existingUser = await User.findOne({
        email: effectiveEmail,
      });

      if (existingUser) {
        console.log(
          `[createPaymentSession] User not authenticated but account exists with email ${effectiveEmail}, returning USER_EXISTS`
        );
        return res.status(400).json({
          success: false,
          message:
            "An account with this email already exists. Please log in to your dashboard to complete payment.",
          code: "USER_EXISTS",
          redirectUrl: `${
            process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3005"
          }/login`,
        });
      }
    }

    const verificationToken = generateTokenService(
      effectiveEmail,
      requestId.toString(),
      "verification"
    );

    const isVerifiedUser = effectiveUser && effectiveUser.isVerified;
    const metadataUserId = effectiveUser ? effectiveUser._id.toString() : "";
    console.log(
      `[createPaymentSession] Storing in Stripe metadata: userId=${metadataUserId || "empty"}, userIsVerified=${isVerifiedUser} (webhook will use for receipt vs verification email)`
    );

    const successUrl = isVerifiedUser
      ? `${
          process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
        }/managed-services/${requestId}?payment=success`
      : `${
          process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
        }/check-email?email=${encodeURIComponent(effectiveEmail)}`;

    // Create Stripe checkout session
    const sessionParams = {
      payment_method_types: ["card"],
      mode: "payment",
      success_url: successUrl,
      cancel_url: `${
        process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
      }/managed-services/payment/${requestId}?canceled=true`,
      client_reference_id: requestId.toString(),
      customer_email: effectiveEmail,
      metadata: {
        requestId: requestId.toString(),
        type: "managed_service",
        verificationToken,
        // Server-derived ownership/identity — never read from req.body.
        userIsVerified: isVerifiedUser ? "true" : "false",
        userId: metadataUserId,
        email: effectiveEmail,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Managed Sourcing Service Fee",
              description: `Service fee for ${request.category} sourcing request`,
            },
            unit_amount: unitAmountCents, // Server-derived from DB
          },
          quantity: 1,
        },
      ],
    };

    const session = await stripe.checkout.sessions.create(sessionParams);

    // Update request with payment session ID
    request.serviceFeePaymentId = session.id;
    await request.save();

    // Upsert the pending Payment record: if one already exists for this managed service
    // (from a previously abandoned session), update it with the new session ID rather
    // than creating another pending record. This prevents syncPaymentsForUser from
    // turning multiple orphaned pending records into multiple "succeeded" transactions.
    const Payment = (await import("../../models/customer/Payment.js")).default;
    let pendingPayment = await Payment.findOne({
      requestId: request._id,
      planType: "managed_service",
      status: "pending",
    });
    if (pendingPayment) {
      pendingPayment.stripeSessionId = session.id;
      pendingPayment.email = effectiveEmail;
      pendingPayment.amount = unitAmountCents / 100;
      if (session.payment_intent && typeof session.payment_intent === "string") {
        pendingPayment.stripePaymentIntentId = session.payment_intent;
      }
      await pendingPayment.save();
    } else {
      pendingPayment = new Payment({
        requestId: request._id,
        matchReportId: null,
        email: effectiveEmail,
        amount: unitAmountCents / 100,
        currency: "usd",
        planType: "managed_service",
        status: "pending",
        stripeSessionId: session.id,
        stripePaymentIntentId:
          session.payment_intent && typeof session.payment_intent === "string"
            ? session.payment_intent
            : null,
      });
      await pendingPayment.save();
    }

    res.json({
      success: true,
      message: "Payment session created",
      data: {
        sessionId: session.id,
        url: session.url,
        requestId,
      },
    });
  } catch (error) {
    console.error("Error creating payment session:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Sync payment status for managed service (manual trigger if webhook failed)
 * This endpoint checks Stripe payment status and updates the managed service accordingly
 */
export const syncPaymentStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const managedService = await ManagedService.findById(id);

    if (!managedService) {
      return res.status(404).json({
        success: false,
        message: "Managed service not found",
      });
    }

    // C-7 — Auth + ownership. This is an authenticated route; req.user is
    // guaranteed by the authenticate middleware on the router.
    // TODO(H-7): drop email fallback once userId is required.
    if (!userOwnsManagedService(req.user, managedService)) {
      console.warn(
        `[syncPaymentStatus] Ownership check FAILED for user ${req.user?._id} on managed service ${id}`
      );
      return res.status(403).json({
        success: false,
        message: "Forbidden",
      });
    }

    // Check service fee payment status
    if (
      managedService.serviceFeeStatus !== "paid" &&
      managedService.serviceFeePaymentId &&
      stripe
    ) {
      try {
        // serviceFeePaymentId is the checkout session ID, retrieve the session
        const session = await stripe.checkout.sessions.retrieve(
          managedService.serviceFeePaymentId
        );

        console.log(
          `[syncPaymentStatus] Service fee session status: ${session.payment_status}, Payment intent: ${session.payment_intent}`
        );

        // C-7 — Bind session to record. The Stripe session must be the one we
        // created for THIS managed service, and its customer_email must match
        // the record's email. Catches metadata tampering and any case where a
        // session ID got reassigned across records.
        const sessionRequestId = (session.metadata?.requestId || "").trim();
        const sessionCustomerEmail = (session.customer_email || "")
          .toLowerCase()
          .trim();
        const recordEmail = (managedService.email || "")
          .toLowerCase()
          .trim();
        if (
          sessionRequestId &&
          sessionRequestId !== managedService._id.toString()
        ) {
          console.error(
            `[syncPaymentStatus] METADATA REQUESTID MISMATCH — refusing sync. ` +
              `route.id=${managedService._id}, session.metadata.requestId=${sessionRequestId}, session=${session.id}`
          );
          return res.status(403).json({
            success: false,
            message: "Forbidden: session does not belong to this request",
          });
        }
        if (
          sessionCustomerEmail &&
          recordEmail &&
          sessionCustomerEmail !== recordEmail
        ) {
          console.error(
            `[syncPaymentStatus] EMAIL BINDING MISMATCH — refusing sync. ` +
              `managedServiceId=${managedService._id}, record.email=${recordEmail}, session.customer_email=${sessionCustomerEmail}, session=${session.id}`
          );
          return res.status(403).json({
            success: false,
            message: "Forbidden: session email does not match request",
          });
        }

        if (session.payment_status === "paid" && session.payment_intent) {
          // Track whether this is the first time we're confirming this payment
          // so we know whether to send the email and create the Payment record.
          const isFirstPaymentConfirmation =
            managedService.serviceFeeStatus !== "paid";

          // Update managed service status
          managedService.serviceFeeStatus = "paid";
          managedService.serviceFeePaymentId = session.payment_intent;
          managedService.serviceFeePaidAt = new Date();
          managedService.status = "in_progress";
          managedService.stage = "review";

          if (!managedService.userId) {
            managedService.userId = req.user._id;
          }

          await managedService.save();

          console.log(
            `[syncPaymentStatus] Successfully synced service fee payment for managed service ${managedService._id}, isFirstPaymentConfirmation: ${isFirstPaymentConfirmation}`
          );

          if (isFirstPaymentConfirmation) {
            // Upsert the Payment record so the transaction appears in history
            // immediately on return from Stripe, without waiting for a webhook.
            // Check by BOTH stripeSessionId and requestId+succeeded so we don't
            // create a duplicate if the webhook already created a succeeded record.
            const existingPayment = await Payment.findOne({
              $or: [
                { stripeSessionId: session.id, planType: "managed_service" },
                {
                  requestId: managedService._id,
                  planType: "managed_service",
                  status: "succeeded",
                },
              ],
            });

            let confirmedPaymentId;
            if (existingPayment) {
              if (existingPayment.status !== "succeeded") {
                existingPayment.status = "succeeded";
                existingPayment.stripePaymentIntentId = session.payment_intent;
                existingPayment.paidAt = new Date(session.created * 1000);
                await existingPayment.save();
                console.log(
                  `[syncPaymentStatus] Updated existing Payment ${existingPayment._id} to succeeded`
                );
              }
              confirmedPaymentId = existingPayment._id.toString();
            } else {
              const newPayment = new Payment({
                requestId: managedService._id,
                email: req.user.email.toLowerCase(),
                amount: managedService.serviceFeeAmount || 0,
                currency: "usd",
                planType: "managed_service",
                status: "succeeded",
                stripePaymentIntentId: session.payment_intent,
                stripeSessionId: session.id,
                paidAt: new Date(session.created * 1000),
              });
              await newPayment.save();
              confirmedPaymentId = newPayment._id.toString();
              console.log(
                `[syncPaymentStatus] Created new Payment ${newPayment._id} for managed service ${managedService._id}`
              );
            }

            // Atomic "claim" for sending the payment email — only one of sync or webhook may send.
            const emailClaimed = await ManagedService.findOneAndUpdate(
              {
                _id: managedService._id,
                $or: [
                  { serviceFeeEmailSentAt: null },
                  { serviceFeeEmailSentAt: { $exists: false } },
                ],
              },
              { $set: { serviceFeeEmailSentAt: new Date() } },
              { new: true }
            );
            if (emailClaimed && req.user.isVerified) {
              try {
                await sendManagedServiceReceiptEmail({
                  email: req.user.email,
                  requestId: managedService._id.toString(),
                  transactionId: confirmedPaymentId,
                  itemName: managedService.itemName,
                  category: managedService.category,
                  serviceFeeAmount: managedService.serviceFeeAmount,
                });
                console.log(
                  `[syncPaymentStatus] Sent receipt email to ${req.user.email}`
                );
              } catch (emailError) {
                console.error(
                  "[syncPaymentStatus] Error sending receipt email:",
                  emailError
                );
              }
            } else if (!emailClaimed) {
              console.log(
                `[syncPaymentStatus] Payment email already sent for ${managedService._id}, skipping`
              );
            }
          }
        }
      } catch (stripeError) {
        console.error(
          "Error checking Stripe service fee payment:",
          stripeError
        );
      }
    }

    // Check savings fee payment status
    if (
      managedService.savingsFeeStatus !== "paid" &&
      managedService.savingsFeePaymentId &&
      stripe
    ) {
      try {
        // savingsFeePaymentId could be a checkout session ID or payment intent ID
        let session;
        try {
          // Try as checkout session first
          session = await stripe.checkout.sessions.retrieve(
            managedService.savingsFeePaymentId
          );
        } catch (e) {
          // If that fails, try as payment intent
          const paymentIntent = await stripe.paymentIntents.retrieve(
            managedService.savingsFeePaymentId
          );
          if (paymentIntent.status === "succeeded") {
            managedService.savingsFeeStatus = "paid";
            managedService.savingsFeePaidAt = new Date();
            await managedService.save();
            console.log(
              `[syncPaymentStatus] Successfully synced savings fee payment for managed service ${managedService._id}`
            );
            return res.json({
              success: true,
              message: "Payment status synced successfully",
              data: managedService,
            });
          }
          return res.json({
            success: false,
            message: "Payment not found or not completed",
            data: managedService,
          });
        }

        console.log(
          `[syncPaymentStatus] Savings fee session status: ${session.payment_status}, Payment intent: ${session.payment_intent}`
        );

        // C-7 — Bind session to record (savings fee). Same checks as above.
        {
          const sfRequestId = (session.metadata?.requestId || "").trim();
          const sfCustomerEmail = (session.customer_email || "")
            .toLowerCase()
            .trim();
          const sfRecordEmail = (managedService.email || "")
            .toLowerCase()
            .trim();
          if (
            sfRequestId &&
            sfRequestId !== managedService._id.toString()
          ) {
            console.error(
              `[syncPaymentStatus] SAVINGS METADATA REQUESTID MISMATCH — refusing sync. ` +
                `route.id=${managedService._id}, session.metadata.requestId=${sfRequestId}, session=${session.id}`
            );
            return res.status(403).json({
              success: false,
              message:
                "Forbidden: savings fee session does not belong to this request",
            });
          }
          if (
            sfCustomerEmail &&
            sfRecordEmail &&
            sfCustomerEmail !== sfRecordEmail
          ) {
            console.error(
              `[syncPaymentStatus] SAVINGS EMAIL BINDING MISMATCH — refusing sync. ` +
                `managedServiceId=${managedService._id}, record.email=${sfRecordEmail}, session.customer_email=${sfCustomerEmail}, session=${session.id}`
            );
            return res.status(403).json({
              success: false,
              message:
                "Forbidden: savings fee session email does not match request",
            });
          }
        }

        if (session.payment_status === "paid" && session.payment_intent) {
          managedService.savingsFeeStatus = "paid";
          managedService.savingsFeePaymentId = session.payment_intent; // Update to payment intent ID
          managedService.savingsFeePaidAt = new Date();
          await managedService.save();

          console.log(
            `[syncPaymentStatus] Successfully synced savings fee payment for managed service ${managedService._id}`
          );
        }
      } catch (stripeError) {
        console.error(
          "Error checking Stripe savings fee payment:",
          stripeError
        );
      }
    }

    return res.json({
      success: true,
      message: "Payment status synced successfully",
      data: managedService,
    });
  } catch (error) {
    console.error("Error syncing payment status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get Single Request Details
 */
export const getRequestDetails = async (req, res) => {
  try {
    const userEmail = req.user.email.toLowerCase().trim();
    const request = await ManagedService.findOne({
      _id: req.params.id,
      $or: [
        { userId: req.user._id },
        {
          email: {
            $regex: new RegExp(
              `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        },
      ],
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Defense-in-depth ownership check on top of the find filter.
    // TODO(H-7): drop email fallback once userId is required.
    if (!userOwnsManagedService(req.user, request)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Link to user if not already linked
    if (
      !request.userId ||
      request.userId.toString() !== req.user._id.toString()
    ) {
      request.userId = req.user._id;
      await request.save();
    }

    // Enrich request with days left calculation
    const enrichedRequest = await enrichManagedService(request);

    res.json({
      success: true,
      data: enrichedRequest,
    });
  } catch (error) {
    console.error("Error getting request details:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update Managed Service Request
 * Only allowed if stage is 'payment_pending' or 'review' (first stage after payment)
 */
export const updateRequest = async (req, res) => {
  try {
    const { id } = req.params;

    // M-9 — Whitelist user-mutable fields. status, stage, serviceFeeAmount,
    // savingsFee*, adminNotes, assignedAdmin, finalReport, suppliers, userId,
    // email and timestamps are NEVER taken from req.body on this buyer route.
    // If the buyer attempts to PUT any of those, the values are silently
    // dropped — the response still reflects the (unchanged) server state.
    const userFields = pickFields(req.body, MS_USER_FIELDS);

    const userEmail = req.user.email.toLowerCase().trim();
    const request = await ManagedService.findOne({
      _id: id,
      $or: [
        { userId: req.user._id },
        {
          email: {
            $regex: new RegExp(
              `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        },
      ],
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Defense-in-depth ownership check on top of the find filter (e.g. an
    // attacker who later guesses an id with a colliding email regex still
    // can't write).
    // TODO(H-7): drop email fallback once userId is required.
    if (!userOwnsManagedService(req.user, request)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Check if editable - allow editing during payment_pending and review stages
    const editableStages = ["payment_pending", "review"];
    if (!editableStages.includes(request.stage)) {
      return res.status(403).json({
        success: false,
        message: "Request cannot be edited in current stage",
      });
    }

    // Category can only be edited before payment (payment_pending stage)
    // After payment, category is locked because it's tied to the service fee price
    if (userFields.category && request.stage === "payment_pending") {
      request.category = userFields.category;
    } else if (userFields.category && request.stage !== "payment_pending") {
      return res.status(403).json({
        success: false,
        message:
          "Category cannot be changed after payment as it affects the service fee",
      });
    }

    // Update other allowed fields (can be edited in both payment_pending and
    // review stages). Buyers cannot modify status/stage/admin/payment fields.
    // M-9 — Note: any req.body keys outside MS_USER_FIELDS were dropped above.
    if (userFields.itemName !== undefined) request.itemName = userFields.itemName;
    if (userFields.subCategory !== undefined)
      request.subCategory = userFields.subCategory;
    if (userFields.subcategory !== undefined)
      request.subcategory = userFields.subcategory;
    if (userFields.specifications !== undefined)
      request.specifications = userFields.specifications;
    if (userFields.description !== undefined)
      request.description = userFields.description;
    if (userFields.quantity !== undefined) request.quantity = userFields.quantity;
    if (userFields.deliveryLocation !== undefined)
      request.deliveryLocation = userFields.deliveryLocation;
    if (userFields.estimatedSpendRange !== undefined)
      request.estimatedSpendRange = userFields.estimatedSpendRange;
    if (userFields.budget !== undefined) request.budget = userFields.budget;
    if (userFields.deadline !== undefined) request.deadline = userFields.deadline;
    if (userFields.urgency !== undefined) request.urgency = userFields.urgency;
    if (userFields.complianceLevel !== undefined)
      request.complianceLevel = userFields.complianceLevel;
    if (userFields.internalDeadline !== undefined) {
      request.internalDeadline = userFields.internalDeadline
        ? new Date(userFields.internalDeadline)
        : undefined;
    }

    await request.save();

    res.json({
      success: true,
      message: "Request updated successfully",
      data: request,
    });
  } catch (error) {
    console.error("Error updating request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Delete a managed service request
 * Only allowed for requests with stage "payment_pending"
 */
export const deleteRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const userEmail = req.user?.email?.toLowerCase().trim();

    if (!id) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
      });
    }

    // Find the request - user must own it (by userId or email)
    const request = await ManagedService.findOne({
      _id: id,
      $or: [
        { userId: req.user._id },
        {
          email: {
            $regex: new RegExp(
              `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
              "i"
            ),
          },
        },
      ],
    });

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Defense-in-depth ownership check.
    // TODO(H-7): drop email fallback once userId is required.
    if (!userOwnsManagedService(req.user, request)) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    // Only allow deletion if stage is "payment_pending"
    if (request.stage !== "payment_pending") {
      return res.status(403).json({
        success: false,
        message: "Only requests with pending payment can be deleted",
      });
    }

    // Delete the request
    await ManagedService.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Request deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
