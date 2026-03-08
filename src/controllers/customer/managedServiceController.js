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
    const {
      itemName,
      category,
      subcategory,
      quantity,
      description,
      estimatedSpendRange,
      urgency,
      complianceLevel,
      deliveryLocation,
      internalDeadline,
      // Legacy fields for backward compatibility
      specifications,
      budget,
      deadline,
    } = req.body;

    const user = req.user; // Authenticated user

    // Validate required fields
    if (
      !itemName ||
      !category ||
      !quantity ||
      !description ||
      !estimatedSpendRange ||
      !urgency ||
      !complianceLevel ||
      !deliveryLocation
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item name, category, quantity, description, estimated spend range, urgency, compliance level, and delivery location are required",
      });
    }

    // Get category to find grade
    const categoryDoc = await Category.findOne({
      name: category,
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

    // Calculate price based on category grade and urgency
    const priceCalculation = calculateManagedServicePrice(
      categoryDoc.grade,
      urgency,
      settings
    );

    // Create the request record
    const request = await ManagedService.create({
      userId: user._id,
      email: user.email,
      itemName,
      category,
      subcategory: subcategory || undefined,
      quantity,
      description,
      estimatedSpendRange,
      urgency,
      complianceLevel,
      deliveryLocation,
      internalDeadline: internalDeadline
        ? new Date(internalDeadline)
        : undefined,
      // Legacy fields (map from new fields if not provided)
      specifications: specifications || description,
      budget: budget || estimatedSpendRange,
      deadline:
        deadline ||
        (internalDeadline
          ? new Date(internalDeadline).toISOString().split("T")[0]
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
    const {
      itemName,
      category,
      subcategory,
      quantity,
      description,
      estimatedSpendRange,
      urgency,
      complianceLevel,
      deliveryLocation,
      internalDeadline,
      email,
      // Legacy fields for backward compatibility
      specifications,
      budget,
      deadline,
    } = req.body;

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
      !itemName ||
      !category ||
      !quantity ||
      !description ||
      !estimatedSpendRange ||
      !urgency ||
      !complianceLevel ||
      !deliveryLocation
    ) {
      return res.status(400).json({
        success: false,
        message:
          "Item name, category, quantity, description, estimated spend range, urgency, compliance level, and delivery location are required",
      });
    }

    // Get category to find grade
    const categoryDoc = await Category.findOne({
      name: category,
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

    // Calculate price based on category grade and urgency
    const priceCalculation = calculateManagedServicePrice(
      categoryDoc.grade,
      urgency,
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
      itemName,
      category,
      subcategory: subcategory || undefined,
      quantity,
      description,
      estimatedSpendRange,
      urgency,
      complianceLevel,
      deliveryLocation,
      internalDeadline: internalDeadline
        ? new Date(internalDeadline)
        : undefined,
      // Legacy fields (map from new fields if not provided)
      specifications: specifications || description,
      budget: budget || estimatedSpendRange,
      deadline:
        deadline ||
        (internalDeadline
          ? new Date(internalDeadline).toISOString().split("T")[0]
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
    const user = req.user; // Authenticated user

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
      });
    }

    // Get the managed service request
    const request = await ManagedService.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Managed service request not found",
      });
    }

    // Verify user owns this request
    if (
      request.userId?.toString() !== user._id.toString() &&
      request.email.toLowerCase() !== user.email.toLowerCase()
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
      });
    }

    // Check if savings fee is applicable
    if (!request.savingsAmount || request.savingsAmount <= 0) {
      return res.status(400).json({
        success: false,
        message: "No savings fee applicable for this request",
      });
    }

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
      customer_email: user.email,
      metadata: {
        requestId: requestId.toString(),
        type: "managed_service_savings_fee",
        paymentType: "savings_fee",
        userIsVerified: user.isVerified ? "true" : "false",
        userId: user._id.toString(),
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
            unit_amount: Math.round(request.savingsFeeAmount * 100), // Convert to cents
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
    const { requestId, amount, email, userId: bodyUserId } = req.body;

    if (!requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required",
      });
    }

    if (!amount || amount <= 0) {
      return res.status(400).json({
        success: false,
        message: "Valid amount is required",
      });
    }

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

    // Get the managed service request
    const request = await ManagedService.findById(requestId);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Managed service request not found",
      });
    }

    // Update email if provided (in case it was different from form submission)
    if (email.trim().toLowerCase() !== request.email.toLowerCase()) {
      request.email = email.trim().toLowerCase();
      await request.save();
    }

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

    // Resolve "effective" user: from auth middleware (req.user) OR from body.userId (fallback if auth header didn't reach us)
    let effectiveUser = req.user || null;
    if (!effectiveUser && bodyUserId) {
      const userByBody = await User.findById(bodyUserId);
      if (userByBody) {
        effectiveUser = userByBody;
        console.log(
          `[createPaymentSession] Using userId from payload: ${bodyUserId}, isVerified: ${effectiveUser.isVerified}`
        );
      }
    }

    const isAuthenticated = !!effectiveUser;

    console.log(
      `[createPaymentSession] Request from email: ${email}, Authenticated: ${isAuthenticated}, User email: ${
        effectiveUser?.email || "none"
      }, bodyUserId: ${bodyUserId ?? "none"}`
    );

    // Only check for existing users if user is NOT authenticated
    if (!isAuthenticated) {
      const existingUser = await User.findOne({
        email: email.trim().toLowerCase(),
      });

      if (existingUser) {
        console.log(
          `[createPaymentSession] User not authenticated but account exists with email ${email}, returning USER_EXISTS`
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
    } else {
      console.log(
        `[createPaymentSession] User is authenticated (${effectiveUser.email}), isVerified: ${effectiveUser.isVerified}`
      );
      if (effectiveUser.email.toLowerCase() !== email.trim().toLowerCase()) {
        console.log(
          `[createPaymentSession] Email mismatch: provided (${email}) vs account (${effectiveUser.email}). Using account email.`
        );
        request.email = effectiveUser.email.toLowerCase();
        await request.save();
      }
    }

    const effectiveEmail = isAuthenticated
      ? effectiveUser.email.toLowerCase()
      : email.trim().toLowerCase();

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
        // Store verification status at payment creation time so the webhook
        // can decide which email to send without any DB lookup or guessing.
        userIsVerified: isVerifiedUser ? "true" : "false",
        userId: metadataUserId,
      },
      line_items: [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: "Managed Sourcing Service Fee",
              description: `Service fee for ${request.category} sourcing request`,
            },
            unit_amount: amount, // Amount in cents
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
      pendingPayment.amount = amount / 100;
      if (session.payment_intent && typeof session.payment_intent === "string") {
        pendingPayment.stripePaymentIntentId = session.payment_intent;
      }
      await pendingPayment.save();
    } else {
      pendingPayment = new Payment({
        requestId: request._id,
        matchReportId: null,
        email: effectiveEmail,
        amount: amount / 100,
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

    // Check if user owns this managed service
    if (
      managedService.userId?.toString() !== req.user._id.toString() &&
      managedService.email.toLowerCase() !== req.user.email.toLowerCase()
    ) {
      return res.status(403).json({
        success: false,
        message: "Access denied",
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
    const {
      category,
      specifications,
      quantity,
      deliveryLocation,
      budget,
      deadline,
    } = req.body;

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
    if (category && request.stage === "payment_pending") {
      request.category = category;
    } else if (category && request.stage !== "payment_pending") {
      return res.status(403).json({
        success: false,
        message:
          "Category cannot be changed after payment as it affects the service fee",
      });
    }

    // Update other allowed fields (can be edited in both payment_pending and review stages)
    if (specifications) request.specifications = specifications;
    if (quantity) request.quantity = quantity;
    if (deliveryLocation) request.deliveryLocation = deliveryLocation;
    if (budget) request.budget = budget;
    if (deadline) request.deadline = deadline;

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
