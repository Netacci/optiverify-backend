import Stripe from "stripe";
import MatchReport from "../../models/customer/MatchReport.js";
import Payment from "../../models/customer/Payment.js";
import User from "../../models/common/User.js";
import BuyerRequest from "../../models/customer/BuyerRequest.js";
import {
  sendPaymentConfirmationEmail,
  sendSubscriptionSetupEmail,
  sendPaymentAndVerificationEmail,
} from "../../services/emailService.js";
import { generateToken as generateTokenService } from "../../services/tokenService.js";

// Initialize Stripe only if valid key is provided
const getStripeInstance = () => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (
    !stripeKey ||
    stripeKey.includes("dummy") ||
    stripeKey === "sk_test_dummy_key_replace_with_real_key"
  ) {
    return null; // Return null for dummy/missing keys
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

// Helper function to check if plan type is a subscription
const isSubscriptionPlan = (planType) => {
  return [
    "starter_monthly",
    "starter_annual",
    "professional_monthly",
    "professional_annual",
  ].includes(planType);
};

// Helper function to get credits for a plan type (async, fetches from Plan collection)
const getCreditsForPlan = async (planType) => {
  const Plan = (await import("../../models/admin/Plan.js")).default;

  // Map planType to planType in database
  // planType format: "starter_monthly" -> planType: "starter"
  let dbPlanType = planType;
  if (planType.includes("_")) {
    dbPlanType = planType.split("_")[0]; // "starter_monthly" -> "starter"
  }

  const plan = await Plan.findOne({
    planType: dbPlanType,
    isActive: true,
  });

  if (plan) {
    return plan.credits || 0;
  }

  // Fallback to defaults if plan not found
  if (planType === "starter_monthly" || planType === "starter_annual") {
    return 5;
  } else if (
    planType === "professional_monthly" ||
    planType === "professional_annual"
  ) {
    return 15;
  }
  return 0;
};

// Helper function to get max rollover credits for a plan type (async, fetches from Plan collection)
const getMaxRolloverCredits = async (planType) => {
  const Plan = (await import("../../models/admin/Plan.js")).default;

  // Map planType to planType in database
  let dbPlanType = planType;
  if (planType.includes("_")) {
    dbPlanType = planType.split("_")[0];
  }

  const plan = await Plan.findOne({
    planType: dbPlanType,
    isActive: true,
  });

  if (plan) {
    return plan.maxRolloverCredits || 0;
  }

  // Fallback to defaults
  if (
    planType === "professional_monthly" ||
    planType === "professional_annual"
  ) {
    return 3;
  }
  return 0;
};

// Helper function to get pricing plans from Plan collection
const getPricingPlans = async () => {
  const Plan = (await import("../../models/admin/Plan.js")).default;
  const SystemSettings = (await import("../../models/admin/SystemSettings.js"))
    .default;

  // Get all active plans
  const plans = await Plan.find({ isActive: true }).sort({ displayOrder: 1 });

  // Get extra credit price from SystemSettings (for backward compatibility)
  let settings = await SystemSettings.findOne({ key: "pricing_config" });
  const extraCreditPrice = settings?.extraCreditPrice || 10;

  // Build plan map from database plans
  const plansMap = {};

  for (const plan of plans) {
    // Create monthly plan entry
    const monthlyPlanType = `${plan.planType}_monthly`;
    plansMap[monthlyPlanType] = {
      amount: plan.price * 100, // Convert to cents
      name: `${plan.name} Monthly`,
      recurring: "month",
      credits: plan.credits,
      maxRolloverCredits: plan.maxRolloverCredits || 0,
    };

    // Create annual plan entry if annual pricing is enabled
    if (plan.hasAnnualPricing && plan.annualPrice) {
      const annualPlanType = `${plan.planType}_annual`;
      plansMap[annualPlanType] = {
        amount: plan.annualPrice * 100, // Convert to cents
        name: `${plan.name} Annual`,
        recurring: "year",
        credits: plan.credits,
        maxRolloverCredits: plan.maxRolloverCredits || 0,
      };
    }

    // Handle basic plan (one-time) - no monthly/annual split
    if (plan.planType === "basic") {
      plansMap["one-time"] = {
        amount: plan.price * 100,
        name: plan.name || "Basic - One-Time Match Unlock",
        credits: plan.credits || 1,
      };
    }
  }

  // Fallback: If no plans found, return empty map (plans should be seeded)
  // Only include extra_credit from SystemSettings
  if (Object.keys(plansMap).length === 0) {
    console.warn(
      "[getPricingPlans] No plans found in database. Please seed plans."
    );
  }

  // Always add extra_credit from SystemSettings
  if (!settings) {
    settings = await SystemSettings.findOne({ key: "pricing_config" });
    if (!settings) {
      settings = await SystemSettings.create({
        key: "pricing_config",
        extraCreditPrice: 10,
      });
    }
  }

  plansMap["extra_credit"] = {
    amount: (settings.extraCreditPrice || 10) * 100,
    name: "Extra Match Credit",
    credits: 1,
  };

  // Add enterprise (hardcoded)
  plansMap["enterprise"] = {
    amount: 0,
    name: "Enterprise Plan",
  };

  return plansMap;
};

// Create Stripe checkout session
export const createCheckoutSession = async (req, res) => {
  try {
    const { requestId, planType, email, quantity } = req.body;

    console.log(`[createCheckoutSession] Received request:`, {
      requestId,
      planType,
      email,
      quantity,
    });

    if (!requestId || !planType) {
      return res.status(400).json({
        success: false,
        message: "Request ID and plan type are required",
      });
    }

    // Check if user is authenticated (req.user would be set by middleware if we use it)
    // But this route might be public. Let's check if we can verify the user.
    let isUserVerified = false;
    let user = null;

    if (req.user) {
      user = req.user;
      if (user && user.isVerified) {
        isUserVerified = true;
      }
    } else if (email) {
      const User = (await import("../../models/common/User.js")).default;
      user = await User.findOne({ email: email.toLowerCase().trim() });
      if (user && user.isVerified) {
        isUserVerified = true;
      }
    }

    // Validate email is required (except for enterprise)
    if (planType !== "enterprise" && (!email || !email.trim())) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Basic email validation
    if (email && planType !== "enterprise") {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(email.trim())) {
        return res.status(400).json({
          success: false,
          message: "Please provide a valid email address",
        });
      }
    }

    // Get match report (optional for extra_credit top-up)
    let matchReport = null;
    if (requestId !== "general") {
      matchReport = await MatchReport.findOne({ requestId });

      // If match report doesn't exist, check if request exists and create a pending match report
      // This happens when authenticated users submit requests without active subscription/credits
      if (!matchReport && planType !== "extra_credit") {
        const buyerRequest = await BuyerRequest.findById(requestId);
        if (!buyerRequest) {
          return res.status(404).json({
            success: false,
            message: "Request not found",
          });
        }

        // Create a pending match report for authenticated users who need to pay
        matchReport = new MatchReport({
          requestId: requestId,
          email: buyerRequest.email,
          status: "pending",
          preview: {
            summary: buyerRequest.description || "",
            category: buyerRequest.category || "",
            matchedCount: 0,
            matchScore: 0,
          },
        });
        await matchReport.save();
        console.log(
          `[createCheckoutSession] Created pending match report for request ${requestId}`
        );
      }
    }

    // For extra_credit top-up, we don't require a matchReport (regardless of requestId)
    // This allows users to top up credits even if they have a pending request
    if (planType !== "extra_credit" && !matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    // Handle enterprise plan (contact sales)
    if (planType === "enterprise") {
      return res.json({
        success: true,
        message: "Please contact sales for enterprise pricing",
        data: {
          type: "enterprise",
          contactEmail: "sales@supplyai.com",
        },
      });
    }

    // Get pricing plans from settings
    const pricingPlans = await getPricingPlans();
    const plan = pricingPlans[planType];
    if (!plan) {
      return res.status(400).json({
        success: false,
        message: "Invalid plan type",
      });
    }

    // Determine redirect URL
    // If verified, go to request details with success param (or billing for top-up)
    // If not verified, go to check-email
    let successUrl;
    if (planType === "extra_credit") {
      // Top-up - redirect to billing page if no requestId, otherwise to request details
      if (requestId === "general") {
        successUrl = isUserVerified
          ? `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/billing?topUp=success`
          : `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/check-email?email=${encodeURIComponent(email.trim())}`;
      } else {
        // Top-up with a requestId - redirect to request details after payment
        successUrl = isUserVerified
          ? `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/requests/${requestId}?payment=success`
          : `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/check-email?email=${encodeURIComponent(
              email.trim() || matchReport?.email || ""
            )}`;
      }
    } else {
      successUrl = isUserVerified
        ? `${
            process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
          }/requests/${requestId}?payment=success`
        : `${
            process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
          }/check-email?email=${encodeURIComponent(
            email.trim() || matchReport?.email || ""
          )}`;
    }

    // Check if payment already exists and succeeded (skip for top-up without request)
    if (requestId !== "general" || planType !== "extra_credit") {
      const existingPayment = await Payment.findOne({
        requestId,
        status: "succeeded",
      });

      if (existingPayment && matchReport) {
        // Set to unlocked after payment if payment already exists
        matchReport.status = "unlocked";
        matchReport.unlockedAt = new Date();
        await matchReport.save();

        return res.json({
          success: true,
          message: "Report already unlocked",
          data: {
            requestId,
            unlocked: true,
            url: successUrl,
          },
        });
      }
    }

    // Generate verification token BEFORE creating Stripe session
    const verificationToken = generateTokenService(
      email.trim() || matchReport?.email || email.trim(),
      requestId.toString(),
      "verification"
    );

    // Create Stripe checkout session
    const sessionParams = {
      payment_method_types: ["card"],
      mode: plan.recurring ? "subscription" : "payment",
      success_url: successUrl,
      cancel_url:
        planType === "extra_credit"
          ? requestId === "general"
            ? `${
                process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
              }/billing?canceled=true`
            : `${
                process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
              }/payment-plans?requestId=${requestId}&topUp=true&canceled=true`
          : `${
              process.env.FRONTEND_URL || "http://localhost:3002"
            }/payment-plans?requestId=${requestId}&canceled=true`,
      client_reference_id: requestId,
      customer_email: email || matchReport?.email || email,
      metadata: {
        requestId: requestId.toString(),
        matchReportId: matchReport?._id?.toString() || "none",
        planType,
        verificationToken, // Store verification token in metadata for webhook
        isTopUp: planType === "extra_credit" ? "true" : "false",
      },
    };

    if (plan.recurring) {
      // Subscription
      sessionParams.line_items = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name: plan.name,
              description: "Unlimited supplier match requests",
            },
            recurring: {
              interval: plan.recurring,
            },
            unit_amount: plan.amount,
          },
          quantity: 1,
        },
      ];
    } else {
      // One-time payment (including extra_credit)
      // For extra_credit, use quantity if provided (default to 1)
      const paymentQuantity =
        planType === "extra_credit" && quantity ? parseInt(quantity) : 1;
      const totalAmount = plan.amount * paymentQuantity;

      sessionParams.line_items = [
        {
          price_data: {
            currency: "usd",
            product_data: {
              name:
                planType === "extra_credit" && paymentQuantity > 1
                  ? `${plan.name} (${paymentQuantity} credits)`
                  : plan.name,
              description:
                planType === "extra_credit"
                  ? `Add ${paymentQuantity} credit${
                      paymentQuantity > 1 ? "s" : ""
                    } to your balance`
                  : "Unlock full supplier match report",
            },
            unit_amount: plan.amount,
          },
          quantity: paymentQuantity,
        },
      ];

      // Store quantity in metadata for webhook
      sessionParams.metadata.quantity = paymentQuantity.toString();
    }

    // Check if Stripe is available (not dummy/missing key)
    if (!stripe) {
      // Return mock session for development when Stripe key is not configured
      console.log("⚠️ Using mock Stripe session (Stripe key not configured)");

      // Calculate total amount (for extra_credit with quantity)
      const paymentQuantity =
        planType === "extra_credit" && quantity ? parseInt(quantity) : 1;
      const totalAmount = (plan.amount * paymentQuantity) / 100; // Convert cents to dollars

      // Create payment record for mock payment
      const payment = new Payment({
        requestId: requestId === "general" ? null : requestId, // Allow null for top-up
        matchReportId: matchReport?._id || null,
        email: email || matchReport?.email || email,
        amount: totalAmount,
        planType,
        status: "pending",
      });
      await payment.save();

      // For mock mode, set to unlocked after payment if there's a match report
      if (matchReport) {
        matchReport.status = "unlocked";
        matchReport.paymentId = payment._id.toString();
        matchReport.unlockedAt = new Date();
        await matchReport.save();
      }

      // For extra_credit top-up, add credits to user account
      if (planType === "extra_credit") {
        const userEmail = (email || matchReport?.email || email)
          .toLowerCase()
          .trim();
        const User = (await import("../../models/common/User.js")).default;
        let user = await User.findOne({ email: userEmail });
        if (user) {
          const creditsBefore = user.matchCredits || 0;
          user.matchCredits = creditsBefore + paymentQuantity;
          await user.save();

          // Create credit transaction record for audit
          const CreditTransaction = (
            await import("../../models/customer/CreditTransaction.js")
          ).default;
          await CreditTransaction.create({
            userId: user._id,
            requestId: requestId === "general" ? null : requestId,
            matchReportId: matchReport?._id || null,
            email: user.email,
            creditsUsed: paymentQuantity,
            creditsBefore,
            creditsAfter: user.matchCredits,
            transactionType: "added",
            reason: "top_up",
            notes: `Credits added from mock extra_credit payment (${paymentQuantity} credits)`,
          });

          console.log(
            `[Mock] Added ${paymentQuantity} credit(s) to user ${user._id}. New total: ${user.matchCredits}`
          );
        }
      }

      payment.status = "succeeded";
      payment.paidAt = new Date();
      await payment.save();

      // Send email with token (skip for extra_credit top-up without request)
      if (planType !== "extra_credit" || requestId !== "general") {
        try {
          const emailToUse = email.trim() || matchReport?.email || email.trim();
          if (planType === "one-time") {
            await sendPaymentConfirmationEmail({
              email: emailToUse,
              requestId: requestId.toString(),
              planType,
              token,
            });
          } else if (isSubscriptionPlan(planType)) {
            await sendSubscriptionSetupEmail({
              email: emailToUse,
              planType,
              token,
            });
          }
        } catch (emailError) {
          console.error("Failed to send email:", emailError);
        }
      }

      // Determine redirect URL for mock mode
      let mockRedirectUrl;
      if (planType === "extra_credit" && requestId === "general") {
        mockRedirectUrl = isUserVerified
          ? `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/billing?topUp=success`
          : `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/check-email?email=${encodeURIComponent(email.trim())}`;
      } else {
        mockRedirectUrl = `${
          process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
        }/check-email?email=${encodeURIComponent(
          email.trim() || matchReport?.email || email.trim()
        )}`;
      }

      return res.json({
        success: true,
        message: "Checkout session created (mock mode)",
        data: {
          sessionId: `mock_session_${Date.now()}`,
          url: mockRedirectUrl,
          requestId,
          planType,
        },
      });
    }

    // Create Stripe checkout session
    let session;
    try {
      console.log(
        `[createCheckoutSession] Creating Stripe session with params:`,
        {
          mode: sessionParams.mode,
          line_items_count: sessionParams.line_items?.length,
          quantity: sessionParams.line_items?.[0]?.quantity,
          planType,
          requestId,
        }
      );
      session = await stripe.checkout.sessions.create(sessionParams);
      console.log(
        `[createCheckoutSession] Stripe session created: ${session.id}`
      );
    } catch (stripeError) {
      console.error("[createCheckoutSession] Stripe error:", stripeError);
      console.error(
        "[createCheckoutSession] Session params that failed:",
        JSON.stringify(sessionParams, null, 2)
      );
      // If Stripe API call fails, return error
      return res.status(500).json({
        success: false,
        message: "Failed to create checkout session",
        error:
          process.env.NODE_ENV === "development"
            ? stripeError.message
            : undefined,
      });
    }

    // Calculate total amount (for extra_credit with quantity)
    const paymentQuantity =
      planType === "extra_credit" && quantity ? parseInt(quantity) : 1;
    const totalAmount = (plan.amount * paymentQuantity) / 100; // Convert cents to dollars

    // Create payment record
    const payment = new Payment({
      requestId: requestId === "general" ? null : requestId, // Allow null for top-up
      matchReportId: matchReport?._id || null,
      email: (email || matchReport?.email || email).toLowerCase().trim(),
      amount: totalAmount, // Total amount including quantity
      planType,
      status: "pending",
      stripeSessionId: session.id, // Save session ID for syncing
    });

    await payment.save();
    console.log(
      `[createCheckoutSession] Created payment record ${
        payment._id
      } for request ${
        requestId || "general (top-up)"
      }, planType: ${planType}, quantity: ${paymentQuantity}`
    );

    res.json({
      success: true,
      message: "Checkout session created",
      data: {
        sessionId: session.id,
        url: session.url,
        requestId,
        planType,
      },
    });
  } catch (error) {
    console.error("Error creating checkout session:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Handle Stripe webhook
export const handleWebhook = async (req, res) => {
  const sig = req.headers["stripe-signature"];
  const webhookSecret =
    process.env.STRIPE_WEBHOOK_SECRET || "whsec_dummy_secret";

  let event;

  try {
    // Verify webhook signature
    if (webhookSecret.includes("dummy") || !stripe) {
      // Mock webhook for development
      console.log(
        "⚠️ Using mock webhook (dummy secret or Stripe not configured)"
      );
      event = req.body;
    } else {
      event = stripe.webhooks.constructEvent(req.body, sig, webhookSecret);
    }
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Handle the event
  try {
    if (event.type === "checkout.session.completed") {
      const session = event.data.object;
      console.log(
        `[Webhook] Received checkout.session.completed event. Session ID: ${session.id}, Type: ${session.metadata?.type}`
      );

      // Check if this is a managed service payment
      if (session.metadata?.type === "managed_service") {
        console.log(
          `[Webhook] Processing managed service payment for requestId: ${session.metadata.requestId}`
        );
        const ManagedService = (
          await import("../../models/customer/ManagedService.js")
        ).default;
        const managedService = await ManagedService.findById(
          session.metadata.requestId
        );

        if (!managedService) {
          console.error(
            `[Webhook] Managed service not found: ${session.metadata.requestId}`
          );
          return res.json({
            received: true,
            error: "Managed service not found",
          });
        }

        const customerEmail = (session.customer_email || managedService.email)
          .toLowerCase()
          .trim();
        console.log(`[Webhook] Customer email: ${customerEmail}`);

        // Create or find user
        let user = await User.findOne({ email: customerEmail });
        if (!user) {
          console.log(`[Webhook] Creating new user for: ${customerEmail}`);
          // Create user if doesn't exist (will be verified when they create password)
          user = new User({
            email: customerEmail,
            isVerified: true, // Mark as verified since payment succeeded
          });
          await user.save();
        } else {
          console.log(`[Webhook] Found existing user: ${user._id}`);
          // Update existing user
          user.isVerified = true;
          await user.save();
        }

        // Link managed service to user if not already linked
        if (
          !managedService.userId ||
          managedService.userId.toString() !== user._id.toString()
        ) {
          console.log(
            `[Webhook] Linking managed service ${managedService._id} to user ${user._id}`
          );
          managedService.userId = user._id;
        }

        // Update managed service payment status
        console.log(
          `[Webhook] Updating managed service status from ${managedService.status} to in_progress`
        );
        managedService.serviceFeeStatus = "paid";
        managedService.serviceFeePaymentId = session.payment_intent;
        managedService.serviceFeePaidAt = new Date();
        managedService.status = "in_progress";
        managedService.stage = "review"; // First step after payment - admin review
        await managedService.save();
        console.log(
          `[Webhook] Successfully updated managed service ${managedService._id}. Status: ${managedService.status}, Stage: ${managedService.stage}`
        );

        // Also create a Payment record for managed service (for consistency and receipts)
        const managedServicePayment = new Payment({
          requestId: managedService._id, // Use managed service ID as requestId
          matchReportId: null, // Managed services don't have match reports
          email: customerEmail,
          amount: managedService.serviceFeeAmount || 0,
          currency: "usd",
          planType: "managed_service",
          status: "succeeded",
          stripePaymentIntentId: session.payment_intent,
          stripeCustomerId: session.customer,
          paidAt: new Date(),
        });
        await managedServicePayment.save();
        console.log(
          `[Webhook] Created Payment record ${managedServicePayment._id} for managed service ${managedService._id}`
        );

        // Use verification token from metadata
        const verificationToken =
          session.metadata?.verificationToken ||
          generateTokenService(
            customerEmail,
            managedService._id.toString(),
            "verification"
          );

        // Send payment confirmation + verification email
        try {
          const { sendPaymentAndVerificationEmail } = await import(
            "../../services/emailService.js"
          );
          await sendPaymentAndVerificationEmail({
            email: customerEmail,
            requestId: managedService._id.toString(),
            planType: "managed_service",
            verificationToken,
          });
        } catch (emailError) {
          console.error("Failed to send email:", emailError);
        }

        return res.json({ received: true });
      }

      // Check if this is a managed service savings fee payment
      if (
        session.metadata?.type === "managed_service_savings_fee" ||
        session.metadata?.paymentType === "savings_fee"
      ) {
        console.log(
          `[Webhook] Processing managed service savings fee payment for requestId: ${session.metadata.requestId}`
        );
        const ManagedService = (
          await import("../../models/customer/ManagedService.js")
        ).default;
        const managedService = await ManagedService.findById(
          session.metadata.requestId
        );

        if (!managedService) {
          console.error(
            `[Webhook] Managed service not found: ${session.metadata.requestId}`
          );
          return res.json({
            received: true,
            error: "Managed service not found",
          });
        }

        const customerEmail = (session.customer_email || managedService.email)
          .toLowerCase()
          .trim();
        console.log(
          `[Webhook] Processing savings fee payment for: ${customerEmail}`
        );

        // Update managed service savings fee status
        managedService.savingsFeeStatus = "paid";
        managedService.savingsFeePaymentId = session.payment_intent;
        managedService.savingsFeePaidAt = new Date();
        await managedService.save();
        console.log(
          `[Webhook] Successfully updated savings fee status for managed service ${managedService._id}`
        );

        // Create Payment record for savings fee
        const savingsFeePayment = new Payment({
          requestId: managedService._id,
          matchReportId: null,
          email: customerEmail,
          amount: managedService.savingsFeeAmount || 0,
          currency: "usd",
          planType: "managed_service_savings_fee",
          status: "succeeded",
          stripePaymentIntentId: session.payment_intent,
          stripeCustomerId: session.customer,
          paidAt: new Date(),
        });
        await savingsFeePayment.save();
        console.log(
          `[Webhook] Created Payment record ${savingsFeePayment._id} for savings fee payment`
        );

        return res.json({ received: true });
      }

      // Regular payment (MatchReport) or top-up (extra_credit)
      // Find payment record by requestId, client_reference_id, or stripeSessionId
      // Priority: stripeSessionId (most reliable), then requestId matches
      let payment = null;

      // First try to find by stripeSessionId (most reliable, especially for top-ups)
      if (session.id) {
        payment = await Payment.findOne({ stripeSessionId: session.id });
        console.log(
          `[Webhook] Search by stripeSessionId=${session.id}: ${
            payment ? `Found payment ${payment._id}` : "Not found"
          }`
        );
      }

      // If not found, try by requestId or client_reference_id
      if (!payment) {
        const searchConditions = [];
        if (session.metadata?.requestId) {
          // Handle "general" requestId for top-ups
          if (session.metadata.requestId === "general") {
            searchConditions.push({
              requestId: null,
              planType: "extra_credit",
            });
          } else {
            searchConditions.push({ requestId: session.metadata.requestId });
          }
        }
        if (session.client_reference_id) {
          if (session.client_reference_id === "general") {
            searchConditions.push({
              requestId: null,
              planType: "extra_credit",
            });
          } else {
            searchConditions.push({ requestId: session.client_reference_id });
          }
        }
        if (searchConditions.length > 0) {
          payment = await Payment.findOne({ $or: searchConditions });
          console.log(
            `[Webhook] Search by requestId/metadata: ${
              payment ? `Found payment ${payment._id}` : "Not found"
            }`
          );
        }
      }

      console.log(
        `[Webhook] Looking for payment with session.id=${session.id}, metadata.requestId=${session.metadata?.requestId}, client_reference_id=${session.client_reference_id}, planType=${session.metadata?.planType}`
      );
      if (payment) {
        console.log(
          `[Webhook] Found existing payment ${payment._id}, planType=${payment.planType}, requestId=${payment.requestId}, status=${payment.status}, email=${payment.email}`
        );
      } else {
        console.log(
          `[Webhook] Payment not found, will try to create from session data`
        );
      }

      // If payment not found, try to create it from session data
      // For top-up payments (extra_credit), we need to handle differently
      if (!payment && session.metadata?.requestId) {
        const requestIdFromMetadata = session.metadata.requestId;
        const planTypeFromMetadata = session.metadata?.planType;
        console.log(
          `[Webhook] Payment not found, creating from session data for requestId: ${requestIdFromMetadata}, planType: ${planTypeFromMetadata}`
        );

        // Handle top-up payments (extra_credit) - can have requestId="general" or actual requestId
        if (planTypeFromMetadata === "extra_credit") {
          try {
            // For top-up, requestId can be "general" (billing page) or actual requestId (request page)
            const isGeneralTopUp = requestIdFromMetadata === "general";
            let matchReportId = null;

            // If it's a top-up for a specific request, try to find the match report
            if (!isGeneralTopUp) {
              const matchReport = await MatchReport.findOne({
                requestId: requestIdFromMetadata,
              });
              if (matchReport) {
                matchReportId = matchReport._id;
              }
            }

            payment = new Payment({
              requestId: isGeneralTopUp ? null : requestIdFromMetadata, // null for general top-up, actual requestId for request-specific top-up
              matchReportId: matchReportId,
              email: (session.customer_email || session.metadata.email || "")
                .toLowerCase()
                .trim(),
              amount: session.amount_total / 100, // Convert cents to dollars
              planType: "extra_credit",
              status: "pending",
              stripeSessionId: session.id,
            });
            await payment.save();
            console.log(
              `[Webhook] Created top-up payment record ${payment._id} from session, requestId: ${payment.requestId}, isGeneral: ${isGeneralTopUp}`
            );
          } catch (createError) {
            console.error(
              `[Webhook] Error creating top-up payment:`,
              createError
            );
          }
        } else {
          // Regular payment with match report
          try {
            const matchReport = await MatchReport.findOne({
              requestId: requestIdFromMetadata,
            });
            if (matchReport) {
              // For subscriptions, get payment intent from subscription invoice
              let paymentIntentId = session.payment_intent;
              if (session.subscription && !paymentIntentId) {
                try {
                  const subscription = await stripe.subscriptions.retrieve(
                    session.subscription
                  );
                  if (subscription.latest_invoice) {
                    const invoice = await stripe.invoices.retrieve(
                      subscription.latest_invoice
                    );
                    if (invoice.payment_intent) {
                      paymentIntentId = invoice.payment_intent;
                    }
                  }
                } catch (subError) {
                  console.error(
                    `[Webhook] Error retrieving subscription payment intent:`,
                    subError
                  );
                }
              }

              payment = new Payment({
                requestId: session.metadata.requestId,
                matchReportId: matchReport._id,
                email: (
                  session.customer_email ||
                  session.metadata.email ||
                  matchReport.email
                )
                  .toLowerCase()
                  .trim(),
                amount: session.amount_total ? session.amount_total / 100 : 0,
                planType: session.metadata?.planType || "one-time",
                status: "succeeded",
                stripePaymentIntentId: paymentIntentId,
                stripeCustomerId: session.customer,
                stripeSubscriptionId: session.subscription,
                paidAt: new Date(),
              });
              await payment.save();
              console.log(
                `[Webhook] Created payment record ${payment._id} from session data`
              );
            }
          } catch (createError) {
            console.error(
              `[Webhook] Error creating payment from session:`,
              createError
            );
          }
        }

        if (payment) {
          console.log(
            `[Webhook] Found/created payment ${payment._id} for request ${payment.requestId}, planType=${payment.planType}, current status=${payment.status}, updating to succeeded`
          );

          try {
            // Always update Stripe IDs from session (don't use || operator to preserve existing values)
            if (session.payment_intent) {
              payment.stripePaymentIntentId = session.payment_intent;
              console.log(
                `[Webhook] Set paymentIntentId: ${session.payment_intent}`
              );
            }
            if (session.customer) {
              payment.stripeCustomerId = session.customer;
              console.log(`[Webhook] Set customerId: ${session.customer}`);
            }
            if (session.subscription) {
              payment.stripeSubscriptionId = session.subscription;

              // For subscriptions, get the payment intent from the subscription's latest invoice
              if (!payment.stripePaymentIntentId && stripe) {
                try {
                  const subscription = await stripe.subscriptions.retrieve(
                    session.subscription
                  );
                  if (subscription.latest_invoice) {
                    const invoice = await stripe.invoices.retrieve(
                      subscription.latest_invoice
                    );
                    if (invoice.payment_intent) {
                      payment.stripePaymentIntentId = invoice.payment_intent;
                      console.log(
                        `[Webhook] Retrieved payment intent ${invoice.payment_intent} from subscription invoice`
                      );
                    }
                  }
                } catch (stripeError) {
                  console.error(
                    `[Webhook] Error retrieving subscription payment intent:`,
                    stripeError
                  );
                }
              }
            }

            // Update payment status to succeeded
            payment.status = "succeeded";
            payment.paidAt = payment.paidAt || new Date();

            // Save payment BEFORE processing credits
            await payment.save();
            console.log(
              `[Webhook] Payment ${payment._id} SAVED successfully with Stripe IDs: customer=${payment.stripeCustomerId}, paymentIntent=${payment.stripePaymentIntentId}, subscription=${payment.stripeSubscriptionId}, status=${payment.status}`
            );
          } catch (saveError) {
            console.error(
              `[Webhook] ERROR saving payment ${payment._id}:`,
              saveError
            );
            throw saveError; // Re-throw to be caught by outer try-catch
          }

          // Handle extra_credit payments (add credits to user account)
          if (payment.planType === "extra_credit") {
            try {
              console.log(
                `[Webhook] Processing extra_credit payment ${payment._id}, amount=${payment.amount}, requestId=${payment.requestId}`
              );
              const userEmail = payment.email.toLowerCase().trim();
              console.log(
                `[Webhook] Looking for user with email: ${userEmail}`
              );
              let user = await User.findOne({ email: userEmail });

              if (!user) {
                console.log(
                  `[Webhook] User not found for email ${userEmail}, creating new user`
                );
                // Create user if doesn't exist (for top-up payments)
                user = new User({
                  email: userEmail,
                  isVerified: false, // Will be verified when they set password
                  matchCredits: 0,
                });
              }

              // Get quantity from metadata if available, otherwise calculate from amount
              const quantityFromMetadata = session.metadata?.quantity
                ? parseInt(session.metadata.quantity)
                : null;
              const creditsToAdd =
                quantityFromMetadata || Math.floor(payment.amount / 10); // $10 per credit
              console.log(
                `[Webhook] Adding ${creditsToAdd} credit(s) to user ${
                  user._id
                } (from metadata: ${quantityFromMetadata}, calculated: ${Math.floor(
                  payment.amount / 10
                )})`
              );
              const creditsBefore = user.matchCredits || 0;
              user.matchCredits = creditsBefore + creditsToAdd;
              await user.save();

              // Create credit transaction record for audit
              const CreditTransaction = (
                await import("../../models/customer/CreditTransaction.js")
              ).default;
              await CreditTransaction.create({
                userId: user._id,
                requestId: payment.requestId || null,
                matchReportId: payment.matchReportId || null,
                email: user.email,
                creditsUsed: creditsToAdd,
                creditsBefore,
                creditsAfter: user.matchCredits,
                transactionType: "added",
                reason: "top_up",
                notes: `Credits added from extra_credit payment (${creditsToAdd} credits)`,
              });

              console.log(
                `[Webhook] Added ${creditsToAdd} credit(s) to user ${user._id}. New total: ${user.matchCredits}`
              );

              // If there's a requestId (not null and not "general"), unlock and process the report
              if (
                payment.requestId &&
                payment.requestId.toString() !== "general"
              ) {
                const BuyerRequest = (
                  await import("../../models/customer/BuyerRequest.js")
                ).default;
                const buyerRequest = await BuyerRequest.findById(
                  payment.requestId
                );

                if (!buyerRequest) {
                  console.log(
                    `[Webhook] Buyer request ${payment.requestId} not found, skipping report processing`
                  );
                } else {
                  // Find or create match report
                  let matchReport = await MatchReport.findOne({
                    requestId: payment.requestId,
                  });

                  if (!matchReport) {
                    // Create a pending match report
                    matchReport = new MatchReport({
                      requestId: payment.requestId,
                      email: buyerRequest.email,
                      status: "pending",
                      preview: {
                        summary: buyerRequest.description || "",
                        category: buyerRequest.category || "",
                        matchedCount: 0,
                        matchScore: 0,
                      },
                    });
                    await matchReport.save();
                    console.log(
                      `[Webhook] Created pending match report ${matchReport._id} for request ${payment.requestId}`
                    );
                  }

                  // Deduct 1 credit to unlock this report
                  if (user && user.matchCredits > 0) {
                    const creditsBefore = user.matchCredits;
                    user.matchCredits -= 1;
                    await user.save();

                    // Create credit transaction record for audit
                    const CreditTransaction = (
                      await import("../../models/customer/CreditTransaction.js")
                    ).default;
                    await CreditTransaction.create({
                      userId: user._id,
                      requestId: payment.requestId,
                      matchReportId: matchReport._id,
                      email: user.email,
                      creditsUsed: 1,
                      creditsBefore,
                      creditsAfter: user.matchCredits,
                      transactionType: "deducted",
                      reason: "unlock_request",
                      notes:
                        "Credit used to unlock report after top-up payment",
                    });

                    console.log(
                      `[Webhook] Deducted 1 credit to unlock report. Remaining: ${user.matchCredits}`
                    );
                  }

                  // Unlock the report
                  matchReport.status = "unlocked";
                  matchReport.paymentId = payment._id.toString();
                  matchReport.unlockedAt = new Date();
                  await matchReport.save();
                  console.log(
                    `[Webhook] Unlocked match report ${matchReport._id} via extra_credit payment`
                  );

                  // If user is verified and has active subscription, automatically generate match
                  const hasActivePlan =
                    user &&
                    user.subscriptionStatus === "active" &&
                    (!user.subscriptionExpiresAt ||
                      new Date(user.subscriptionExpiresAt) > new Date());

                  if (
                    user &&
                    user.isVerified &&
                    hasActivePlan &&
                    user.matchCredits > 0
                  ) {
                    console.log(
                      `[Webhook] User is verified with active subscription, automatically generating match for request ${payment.requestId}`
                    );

                    try {
                      // Import required modules for match generation
                      const Supplier = (
                        await import("../../models/admin/Supplier.js")
                      ).default;
                      const {
                        calculateAIMatchScore,
                        generateAIExplanation,
                        generateRequestSummary,
                      } = await import("../../services/aiService.js");

                      // Find matching suppliers
                      const allSuppliers = await Supplier.find({
                        isActive: true,
                      });

                      if (allSuppliers.length > 0) {
                        // Calculate match scores using AI
                        console.log(
                          `[Webhook] Calculating match scores for ${allSuppliers.length} suppliers...`
                        );
                        const suppliersWithScores = await Promise.all(
                          allSuppliers.map(async (supplier) => {
                            const matchResult = await calculateAIMatchScore(
                              buyerRequest,
                              supplier
                            );
                            return {
                              supplier,
                              matchScore: matchResult.score,
                              factors: matchResult.factors,
                              whyMatch: matchResult.whyMatch,
                              strengths: matchResult.strengths || [],
                              concerns: matchResult.concerns || [],
                              aiGenerated: matchResult.aiGenerated || false,
                            };
                          })
                        );

                        // Sort by match score (highest first)
                        suppliersWithScores.sort(
                          (a, b) => b.matchScore - a.matchScore
                        );

                        // Filter suppliers with score > 0 and get top 5
                        const qualifiedSuppliers = suppliersWithScores.filter(
                          (item) => item.matchScore > 0
                        );
                        const topSuppliers = qualifiedSuppliers.slice(0, 5);

                        if (topSuppliers.length > 0) {
                          // Generate summary and explanations
                          const requestSummary = await generateRequestSummary(
                            buyerRequest
                          );
                          const previewSupplier = topSuppliers[0].supplier;
                          const averageScore = Math.round(
                            topSuppliers.reduce(
                              (sum, item) => sum + item.matchScore,
                              0
                            ) / topSuppliers.length
                          );

                          const suppliersWithExplanations = await Promise.all(
                            topSuppliers.map(async (item, index) => {
                              const explanation = await generateAIExplanation(
                                buyerRequest,
                                item.supplier,
                                item.matchScore,
                                item.factors
                              );

                              return {
                                supplierId: item.supplier._id,
                                matchScore: item.matchScore,
                                ranking: index + 1,
                                whyTheyMatch:
                                  item.whyMatch || item.factors.join(", "),
                                aiExplanation: explanation,
                                strengths: item.strengths,
                                concerns: item.concerns,
                              };
                            })
                          );

                          // Deduct 1 credit for match generation
                          const creditsBeforeMatch = user.matchCredits;
                          user.matchCredits -= 1;
                          await user.save();

                          // Create credit transaction for match generation
                          const CreditTransaction = (
                            await import(
                              "../../models/customer/CreditTransaction.js"
                            )
                          ).default;
                          await CreditTransaction.create({
                            userId: user._id,
                            requestId: payment.requestId,
                            matchReportId: matchReport._id,
                            email: user.email,
                            creditsUsed: 1,
                            creditsBefore: creditsBeforeMatch,
                            creditsAfter: user.matchCredits,
                            transactionType: "deducted",
                            reason: "match_generation",
                            notes:
                              "Credit used for AI match generation after top-up",
                          });

                          // Update match report with generated data
                          matchReport.status = "completed";
                          matchReport.preview = {
                            summary: requestSummary,
                            category: buyerRequest.category,
                            matchedCount: topSuppliers.length,
                            matchScore: averageScore,
                            previewSupplier: previewSupplier._id,
                          };
                          matchReport.fullReport = {
                            suppliers: suppliersWithExplanations,
                            generatedAt: new Date(),
                          };
                          await matchReport.save();

                          // Update buyer request status
                          buyerRequest.status = "processing";
                          await buyerRequest.save();

                          console.log(
                            `[Webhook] Successfully generated match report for request ${payment.requestId} with ${topSuppliers.length} suppliers`
                          );
                        } else {
                          console.log(
                            `[Webhook] No qualified suppliers found for request ${payment.requestId}`
                          );
                        }
                      } else {
                        console.log(
                          `[Webhook] No suppliers available in database for request ${payment.requestId}`
                        );
                      }
                    } catch (matchError) {
                      console.error(
                        `[Webhook] Error generating match for request ${payment.requestId}:`,
                        matchError
                      );
                      // Don't fail the webhook if match generation fails
                      // The user can still manually trigger it later
                    }
                  } else {
                    console.log(
                      `[Webhook] User not verified or no active subscription, match will be generated when user clicks "Generate AI Match" button`
                    );
                  }
                }
              }

              // Send payment confirmation email for top-up
              try {
                const emailUser = await User.findOne({ email: userEmail });
                if (emailUser && emailUser.isVerified) {
                  await sendPaymentConfirmationEmail({
                    email: payment.email,
                    requestId: payment.requestId?.toString() || "top-up",
                    planType: payment.planType,
                    token: session.metadata?.verificationToken || "",
                  });
                }
              } catch (emailError) {
                console.error("[Webhook] Failed to send email:", emailError);
                // Don't fail the webhook if email fails
              }

              // Return early for extra_credit payments (we've handled everything)
              // Payment status is already saved above
              console.log(
                `[Webhook] Completed extra_credit payment processing for ${payment._id}, credits added successfully`
              );
              return res.json({ received: true });
            } catch (creditError) {
              console.error(
                `[Webhook] ERROR processing extra_credit payment ${payment._id}:`,
                creditError
              );
              console.error(`[Webhook] Credit error stack:`, creditError.stack);
              // Payment status is already saved, so we can still return success
              // The sync endpoint can retry credit addition later
              return res.json({
                received: true,
                warning: "Payment saved but credit addition failed",
              });
            }
          }

          // Handle match report status based on payment type
          const matchReport = await MatchReport.findById(payment.matchReportId);
          if (matchReport) {
            // For all payments (one-time and subscriptions), set status to "unlocked"
            // so users can trigger AI matching after login
            console.log(
              `[Webhook] Setting match report ${matchReport._id} to unlocked after payment (planType: ${payment.planType})`
            );
            matchReport.status = "unlocked";
            matchReport.paymentId = payment._id.toString();
            matchReport.unlockedAt = new Date();
            await matchReport.save();
            console.log(
              `[Webhook] Match report ${matchReport._id} updated successfully (status: ${matchReport.status})`
            );
          }

          // Use verification token from metadata if available (generated before Stripe session)
          // Otherwise generate a new one (fallback for older payments or edge cases)
          const verificationToken =
            session.metadata?.verificationToken ||
            generateTokenService(
              payment.email,
              payment.requestId?.toString() || "general",
              "verification"
            );

          // Update user subscription if it's a subscription plan
          let isVerifiedUser = false;

          if (isSubscriptionPlan(payment.planType)) {
            const userEmail = payment.email.toLowerCase().trim();
            let user = await User.findOne({
              email: userEmail,
            });

            if (!user) {
              // Create user if doesn't exist (will be verified when they click email link)
              console.log(
                `[Webhook] Creating new user for subscription payment: ${userEmail}`
              );
              user = new User({
                email: userEmail,
                isVerified: false,
              });
            } else {
              console.log(
                `[Webhook] Found existing user ${user._id} for subscription payment: ${userEmail}`
              );
              if (user.isVerified) isVerifiedUser = true;
            }

            user.subscriptionStatus = "active";
            user.subscriptionPlan = payment.planType;
            user.stripeCustomerId = session.customer;
            user.stripeSubscriptionId = session.subscription;

            // Handle credits with rollover for professional plans
            const creditsForPlan = await getCreditsForPlan(payment.planType);
            const maxRollover = await getMaxRolloverCredits(payment.planType);
            const currentCredits = user.matchCredits || 0;
            const creditsBefore = currentCredits;

            if (maxRollover > 0 && currentCredits > 0) {
              // Professional plan: rollover up to maxRollover credits
              const rolloverCredits = Math.min(currentCredits, maxRollover);
              user.matchCredits = creditsForPlan + rolloverCredits;
            } else {
              // Starter plan or no existing credits: just set new credits
              user.matchCredits = creditsForPlan;
            }

            // Create credit transaction record for audit
            const CreditTransaction = (
              await import("../../models/customer/CreditTransaction.js")
            ).default;
            await CreditTransaction.create({
              userId: user._id,
              requestId: null, // Subscription allocation not tied to specific request
              matchReportId: null,
              email: user.email,
              creditsUsed: user.matchCredits - creditsBefore,
              creditsBefore,
              creditsAfter: user.matchCredits,
              transactionType: "added",
              reason: "subscription_allocation",
              notes: `Credits allocated from ${payment.planType} subscription`,
            });

            // Set expiry date (create new Date objects to avoid mutation)
            const now = new Date();
            if (
              payment.planType === "starter_monthly" ||
              payment.planType === "professional_monthly"
            ) {
              const expiryDate = new Date(now);
              expiryDate.setMonth(expiryDate.getMonth() + 1);
              user.subscriptionExpiresAt = expiryDate;
            } else if (
              payment.planType === "starter_annual" ||
              payment.planType === "professional_annual"
            ) {
              const expiryDate = new Date(now);
              expiryDate.setFullYear(expiryDate.getFullYear() + 1);
              user.subscriptionExpiresAt = expiryDate;
            }

            await user.save();
            console.log(
              `[Webhook] Updated user ${user._id} with subscription ${payment.planType}, expires at ${user.subscriptionExpiresAt}`
            );
          } else if (payment.planType === "extra_credit") {
            // For extra_credit payments, add credits (already handled above, but check verification)
            const user = await User.findOne({
              email: payment.email.toLowerCase().trim(),
            });
            if (user && user.isVerified) isVerifiedUser = true;
          } else {
            // For one-time payments, just check verification status
            const user = await User.findOne({
              email: payment.email.toLowerCase().trim(),
            });
            if (user && user.isVerified) isVerifiedUser = true;
          }

          // Send combined payment confirmation + verification email
          // This should happen for ALL payments, not just when matchReport exists
          try {
            if (isVerifiedUser) {
              // User is already verified, just send receipt
              await sendPaymentConfirmationEmail({
                email: payment.email,
                requestId: payment.requestId?.toString() || "general",
                planType: payment.planType,
                token: verificationToken, // Pass token just in case, but URL in email will differ
              });
            } else {
              // User needs verification
              await sendPaymentAndVerificationEmail({
                email: payment.email,
                requestId: payment.requestId?.toString() || "general",
                planType: payment.planType,
                verificationToken,
              });
            }
            console.log(
              `[Webhook] Sent payment confirmation email to ${payment.email}`
            );
          } catch (emailError) {
            console.error("Failed to send email:", emailError);
            // Don't fail the payment if email fails - payment is already successful
          }
        }
      }
    } else if (event.type === "payment_intent.succeeded") {
      const paymentIntent = event.data.object;
      // Handle successful payment
      console.log("Payment succeeded:", paymentIntent.id);
    } else if (event.type === "invoice.payment_succeeded") {
      const invoice = event.data.object;
      console.log(
        `[Webhook] Invoice payment succeeded: ${invoice.id}, Subscription: ${invoice.subscription}`
      );

      if (invoice.subscription) {
        // Find user by stripe subscription ID
        let user = await User.findOne({
          stripeSubscriptionId: invoice.subscription,
        });

        // If not found by subscription ID, try email
        if (!user && invoice.customer_email) {
          user = await User.findOne({
            email: invoice.customer_email.toLowerCase().trim(),
          });
        }

        if (user) {
          console.log(
            `[Webhook] resetting credits for user ${user._id} on subscription renewal`
          );
          user.matchCredits = 25;
          user.subscriptionStatus = "active";

          // Extend expiry
          const now = new Date();
          // We don't know plan type easily here without fetching sub, but usually we can infer or just add 1 month/year based on current plan
          // Or just rely on subscription status.
          // For simplicity, just ensure active and credits.
          // Ideally we fetch subscription to know interval, but let's assume monthly if not set or just leave expiry management to the checkout flow for now.
          // But for credits, we MUST reset.
          await user.save();
        }
      }
    }
  } catch (error) {
    console.error("[Webhook] CRITICAL ERROR handling webhook:", error);
    console.error("[Webhook] Error stack:", error.stack);
    // Return error status so Stripe will retry
    return res.status(500).json({
      received: false,
      error: error.message,
    });
  }

  res.json({ received: true });
};

// Sync payment status for regular payments (manual trigger if webhook failed)
export const syncPaymentStatus = async (req, res) => {
  try {
    const { requestId } = req.params;
    const user = req.user;

    // Find the LATEST payment record for this request
    // We sort by createdAt desc to get the most recent attempt
    const payment = await Payment.findOne({
      requestId,
      email: {
        $regex: new RegExp(
          `^${user.email
            .toLowerCase()
            .trim()
            .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
      },
    }).sort({ createdAt: -1 });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found",
      });
    }

    // If already succeeded, return current status
    if (payment.status === "succeeded") {
      return res.json({
        success: true,
        message: "Payment already processed",
        data: payment,
      });
    }

    // Check Stripe payment status
    if (stripe) {
      try {
        // First, try to retrieve by payment intent if we have it
        if (payment.stripePaymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            payment.stripePaymentIntentId
          );

          console.log(
            `[syncPaymentStatus] Payment intent status: ${paymentIntent.status}`
          );

          if (paymentIntent.status === "succeeded") {
            // Update payment status
            payment.status = "succeeded";
            payment.paidAt = new Date();
            await payment.save();

            // Set match report to unlocked after payment
            const matchReport = await MatchReport.findById(
              payment.matchReportId
            );
            if (matchReport && matchReport.status !== "unlocked") {
              matchReport.status = "unlocked";
              matchReport.paymentId = payment._id.toString();
              matchReport.unlockedAt = new Date();
              await matchReport.save();
              console.log(
                `[syncPaymentStatus] Set match report ${matchReport._id} to unlocked after payment`
              );
            }

            console.log(
              `[syncPaymentStatus] Successfully synced payment ${payment._id}`
            );

            return res.json({
              success: true,
              message: "Payment status synced successfully",
              data: payment,
            });
          }
        } else if (payment.stripeSessionId) {
          // If we have session ID, check that directly
          const session = await stripe.checkout.sessions.retrieve(
            payment.stripeSessionId
          );

          console.log(
            `[syncPaymentStatus] Session status: ${session.payment_status}`
          );

          if (session.payment_status === "paid") {
            // Update payment with payment intent ID and status
            payment.stripePaymentIntentId = session.payment_intent;
            payment.stripeCustomerId = session.customer;
            if (session.subscription) {
              payment.stripeSubscriptionId = session.subscription;
            }
            payment.status = "succeeded";
            payment.paidAt = new Date();
            await payment.save();

            // Handle extra_credit payments (add credits and process request)
            if (payment.planType === "extra_credit") {
              try {
                console.log(
                  `[syncPaymentStatus] Processing extra_credit payment ${payment._id}, amount=${payment.amount}, requestId=${payment.requestId}`
                );
                const userEmail = payment.email.toLowerCase().trim();
                let creditUser = await User.findOne({ email: userEmail });

                if (!creditUser) {
                  console.log(
                    `[syncPaymentStatus] User not found for email ${userEmail}, creating new user`
                  );
                  creditUser = new User({
                    email: userEmail,
                    isVerified: false,
                    matchCredits: 0,
                  });
                }

                // Get quantity from metadata if available, otherwise calculate from amount
                const quantityFromMetadata = session.metadata?.quantity
                  ? parseInt(session.metadata.quantity)
                  : null;
                const creditsToAdd =
                  quantityFromMetadata || Math.floor(payment.amount / 10); // $10 per credit
                console.log(
                  `[syncPaymentStatus] Adding ${creditsToAdd} credit(s) to user ${creditUser._id}`
                );
                const creditsBefore = creditUser.matchCredits || 0;
                creditUser.matchCredits = creditsBefore + creditsToAdd;
                await creditUser.save();

                // Create credit transaction record for audit
                const CreditTransaction = (
                  await import("../../models/customer/CreditTransaction.js")
                ).default;
                await CreditTransaction.create({
                  userId: creditUser._id,
                  requestId: payment.requestId || null,
                  matchReportId: payment.matchReportId || null,
                  email: creditUser.email,
                  creditsUsed: creditsToAdd,
                  creditsBefore,
                  creditsAfter: creditUser.matchCredits,
                  transactionType: "added",
                  reason: "top_up",
                  notes: `Credits added from extra_credit payment (${creditsToAdd} credits)`,
                });

                console.log(
                  `[syncPaymentStatus] Added ${creditsToAdd} credit(s) to user ${creditUser._id}. New total: ${creditUser.matchCredits}`
                );

                // If there's a requestId (not null and not "general"), unlock and process the report
                if (
                  payment.requestId &&
                  payment.requestId.toString() !== "general"
                ) {
                  const BuyerRequest = (
                    await import("../../models/customer/BuyerRequest.js")
                  ).default;
                  const buyerRequest = await BuyerRequest.findById(
                    payment.requestId
                  );

                  if (!buyerRequest) {
                    console.log(
                      `[syncPaymentStatus] Buyer request ${payment.requestId} not found, skipping report processing`
                    );
                  } else {
                    // Find or create match report
                    let matchReport = await MatchReport.findOne({
                      requestId: payment.requestId,
                    });

                    if (!matchReport) {
                      // Create a pending match report
                      matchReport = new MatchReport({
                        requestId: payment.requestId,
                        email: buyerRequest.email,
                        status: "pending",
                        preview: {
                          summary: buyerRequest.description || "",
                          category: buyerRequest.category || "",
                          matchedCount: 0,
                          matchScore: 0,
                        },
                      });
                      await matchReport.save();
                      console.log(
                        `[syncPaymentStatus] Created pending match report ${matchReport._id} for request ${payment.requestId}`
                      );
                    }

                    // Deduct 1 credit to unlock this report
                    if (creditUser && creditUser.matchCredits > 0) {
                      const creditsBeforeUnlock = creditUser.matchCredits;
                      creditUser.matchCredits -= 1;
                      await creditUser.save();

                      // Create credit transaction record for audit
                      await CreditTransaction.create({
                        userId: creditUser._id,
                        requestId: payment.requestId,
                        matchReportId: matchReport._id,
                        email: creditUser.email,
                        creditsUsed: 1,
                        creditsBefore: creditsBeforeUnlock,
                        creditsAfter: creditUser.matchCredits,
                        transactionType: "deducted",
                        reason: "unlock_request",
                        notes:
                          "Credit used to unlock report after top-up payment",
                      });

                      console.log(
                        `[syncPaymentStatus] Deducted 1 credit to unlock report. Remaining: ${creditUser.matchCredits}`
                      );
                    }

                    // Unlock the report
                    matchReport.status = "unlocked";
                    matchReport.paymentId = payment._id.toString();
                    matchReport.unlockedAt = new Date();
                    await matchReport.save();

                    // Update payment record with matchReportId if it wasn't set
                    if (!payment.matchReportId) {
                      payment.matchReportId = matchReport._id;
                      await payment.save();
                    }

                    console.log(
                      `[syncPaymentStatus] Unlocked match report ${matchReport._id} via extra_credit payment`
                    );

                    // If user is verified and has active subscription, automatically generate match
                    const hasActivePlan =
                      creditUser &&
                      creditUser.subscriptionStatus === "active" &&
                      (!creditUser.subscriptionExpiresAt ||
                        new Date(creditUser.subscriptionExpiresAt) >
                          new Date());

                    if (
                      creditUser &&
                      creditUser.isVerified &&
                      hasActivePlan &&
                      creditUser.matchCredits > 0
                    ) {
                      console.log(
                        `[syncPaymentStatus] User is verified with active subscription, automatically generating match for request ${payment.requestId}`
                      );

                      try {
                        // Import required modules for match generation
                        const Supplier = (
                          await import("../../models/admin/Supplier.js")
                        ).default;
                        const {
                          calculateAIMatchScore,
                          generateAIExplanation,
                          generateRequestSummary,
                        } = await import("../../services/aiService.js");

                        // Find matching suppliers
                        const allSuppliers = await Supplier.find({
                          isActive: true,
                        });

                        if (allSuppliers.length > 0) {
                          // Calculate match scores using AI
                          console.log(
                            `[syncPaymentStatus] Calculating match scores for ${allSuppliers.length} suppliers...`
                          );
                          const suppliersWithScores = await Promise.all(
                            allSuppliers.map(async (supplier) => {
                              const matchResult = await calculateAIMatchScore(
                                buyerRequest,
                                supplier
                              );
                              return {
                                supplier,
                                matchScore: matchResult.score,
                                factors: matchResult.factors,
                                whyMatch: matchResult.whyMatch,
                                strengths: matchResult.strengths || [],
                                concerns: matchResult.concerns || [],
                                aiGenerated: matchResult.aiGenerated || false,
                              };
                            })
                          );

                          // Sort by match score (highest first)
                          suppliersWithScores.sort(
                            (a, b) => b.matchScore - a.matchScore
                          );

                          // Filter suppliers with score > 0 and get top 5
                          const qualifiedSuppliers = suppliersWithScores.filter(
                            (item) => item.matchScore > 0
                          );
                          const topSuppliers = qualifiedSuppliers.slice(0, 5);

                          if (topSuppliers.length > 0) {
                            // Generate summary and explanations
                            const requestSummary = await generateRequestSummary(
                              buyerRequest
                            );
                            const previewSupplier = topSuppliers[0].supplier;
                            const averageScore = Math.round(
                              topSuppliers.reduce(
                                (sum, item) => sum + item.matchScore,
                                0
                              ) / topSuppliers.length
                            );

                            const suppliersWithExplanations = await Promise.all(
                              topSuppliers.map(async (item, index) => {
                                const explanation = await generateAIExplanation(
                                  buyerRequest,
                                  item.supplier,
                                  item.matchScore,
                                  item.factors
                                );

                                return {
                                  supplierId: item.supplier._id,
                                  matchScore: item.matchScore,
                                  ranking: index + 1,
                                  whyTheyMatch:
                                    item.whyMatch || item.factors.join(", "),
                                  aiExplanation: explanation,
                                  strengths: item.strengths,
                                  concerns: item.concerns,
                                };
                              })
                            );

                            // Deduct 1 credit for match generation
                            const creditsBeforeMatch = creditUser.matchCredits;
                            creditUser.matchCredits -= 1;
                            await creditUser.save();

                            // Create credit transaction for match generation
                            await CreditTransaction.create({
                              userId: creditUser._id,
                              requestId: payment.requestId,
                              matchReportId: matchReport._id,
                              email: creditUser.email,
                              creditsUsed: 1,
                              creditsBefore: creditsBeforeMatch,
                              creditsAfter: creditUser.matchCredits,
                              transactionType: "deducted",
                              reason: "match_generation",
                              notes:
                                "Credit used for AI match generation after top-up",
                            });

                            // Update match report with generated data
                            matchReport.status = "completed";
                            matchReport.preview = {
                              summary: requestSummary,
                              category: buyerRequest.category,
                              matchedCount: topSuppliers.length,
                              matchScore: averageScore,
                              previewSupplier: previewSupplier._id,
                            };
                            matchReport.fullReport = {
                              suppliers: suppliersWithExplanations,
                              generatedAt: new Date(),
                            };
                            await matchReport.save();

                            // Update buyer request status
                            buyerRequest.status = "processing";
                            await buyerRequest.save();

                            console.log(
                              `[syncPaymentStatus] Successfully generated match report for request ${payment.requestId} with ${topSuppliers.length} suppliers`
                            );
                          } else {
                            console.log(
                              `[syncPaymentStatus] No qualified suppliers found for request ${payment.requestId}`
                            );
                          }
                        } else {
                          console.log(
                            `[syncPaymentStatus] No suppliers available in database for request ${payment.requestId}`
                          );
                        }
                      } catch (matchError) {
                        console.error(
                          `[syncPaymentStatus] Error generating match for request ${payment.requestId}:`,
                          matchError
                        );
                        // Don't fail the sync if match generation fails
                      }
                    } else {
                      console.log(
                        `[syncPaymentStatus] User not verified or no active subscription, match will be generated when user clicks "Generate AI Match" button`
                      );
                    }
                  }
                }

                console.log(
                  `[syncPaymentStatus] Completed extra_credit payment processing for ${payment._id}`
                );
              } catch (creditError) {
                console.error(
                  `[syncPaymentStatus] ERROR processing extra_credit payment ${payment._id}:`,
                  creditError
                );
                // Don't fail the sync if credit processing fails
              }
            } else {
              // Set match report to unlocked after payment (for non-extra_credit payments)
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
                console.log(
                  `[syncPaymentStatus] Set match report ${matchReport._id} to unlocked after payment`
                );
              }
            }

            // Check for subscription and update user if needed
            if (session.subscription) {
              console.log(
                `[syncPaymentStatus] Found subscription ${session.subscription} in session`
              );

              // Update user subscription
              user.subscriptionStatus = "active";
              user.subscriptionPlan = payment.planType;
              user.stripeCustomerId = session.customer;
              user.stripeSubscriptionId = session.subscription;

              // Handle credits with rollover for professional plans
              const creditsForPlan = await getCreditsForPlan(payment.planType);
              const maxRollover = await getMaxRolloverCredits(payment.planType);
              const currentCredits = user.matchCredits || 0;
              const creditsBefore = currentCredits;

              if (maxRollover > 0 && currentCredits > 0) {
                // Professional plan: rollover up to maxRollover credits
                const rolloverCredits = Math.min(currentCredits, maxRollover);
                user.matchCredits = creditsForPlan + rolloverCredits;
              } else {
                // Starter plan or no existing credits: just set new credits
                user.matchCredits = creditsForPlan;
              }

              // Create credit transaction record for audit
              const CreditTransaction = (
                await import("../../models/customer/CreditTransaction.js")
              ).default;
              await CreditTransaction.create({
                userId: user._id,
                requestId: null, // Subscription allocation not tied to specific request
                matchReportId: null,
                email: user.email,
                creditsUsed: user.matchCredits - creditsBefore,
                creditsBefore,
                creditsAfter: user.matchCredits,
                transactionType: "added",
                reason: "subscription_allocation",
                notes: `Credits allocated from ${payment.planType} subscription (sync)`,
              });

              const now = new Date();
              if (
                payment.planType === "starter_monthly" ||
                payment.planType === "professional_monthly"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setMonth(expiryDate.getMonth() + 1);
                user.subscriptionExpiresAt = expiryDate;
              } else if (
                payment.planType === "starter_annual" ||
                payment.planType === "professional_annual"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                user.subscriptionExpiresAt = expiryDate;
              }

              await user.save();
              console.log(
                `[syncPaymentStatus] Updated user ${user._id} subscription via sync with ${user.matchCredits} credits`
              );
            }

            console.log(
              `[syncPaymentStatus] Successfully synced payment ${payment._id} from session ID`
            );

            return res.json({
              success: true,
              message: "Payment status synced successfully",
              data: payment,
            });
          }
        } else {
          // Fallback: If no IDs, try to list sessions (less reliable)
          // List recent checkout sessions and find one matching this requestId
          const sessions = await stripe.checkout.sessions.list({
            limit: 100,
          });

          const matchingSession = sessions.data.find(
            (s) =>
              s.client_reference_id === requestId && s.payment_status === "paid"
          );

          if (matchingSession && matchingSession.payment_intent) {
            // Update payment with payment intent ID
            payment.stripePaymentIntentId = matchingSession.payment_intent;
            payment.stripeCustomerId = matchingSession.customer;
            payment.status = "succeeded";
            payment.paidAt = new Date();
            await payment.save();

            // Set match report to unlocked after payment
            const matchReport = await MatchReport.findById(
              payment.matchReportId
            );
            if (matchReport && matchReport.status !== "unlocked") {
              matchReport.status = "unlocked";
              matchReport.paymentId = payment._id.toString();
              matchReport.unlockedAt = new Date();
              await matchReport.save();
              console.log(
                `[syncPaymentStatus] Set match report ${matchReport._id} to unlocked after payment`
              );
            }

            console.log(
              `[syncPaymentStatus] Successfully synced payment ${payment._id} from checkout session`
            );

            return res.json({
              success: true,
              message: "Payment status synced successfully",
              data: payment,
            });
          }
        }
      } catch (stripeError) {
        console.error("Error checking Stripe payment:", stripeError);
      }
    }

    // If we have a checkout session ID, try to retrieve it
    // Note: We'd need to store the session ID in the payment record for this to work
    // For now, return error if we can't sync

    return res.json({
      success: false,
      message: "Payment not found or not completed in Stripe",
      data: payment,
    });
  } catch (error) {
    console.error("Error syncing payment status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Sync all payments and subscriptions for the current user
export const syncUserPayments = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }
    const userEmail = user.email.toLowerCase().trim();

    console.log(
      `[syncUserPayments] Syncing payments for user ${user._id} (${userEmail})`
    );

    if (!stripe) {
      return res.status(400).json({
        success: false,
        message: "Stripe is not configured",
      });
    }

    // Find all pending payments for this user
    const pendingPayments = await Payment.find({
      email: {
        $regex: new RegExp(
          `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
      },
      status: "pending",
    });

    let syncedCount = 0;
    let subscriptionUpdated = false;

    // Sync each pending payment
    for (const payment of pendingPayments) {
      try {
        if (payment.stripePaymentIntentId) {
          const paymentIntent = await stripe.paymentIntents.retrieve(
            payment.stripePaymentIntentId
          );
          if (paymentIntent.status === "succeeded") {
            payment.status = "succeeded";
            payment.paidAt = new Date();
            await payment.save();
            syncedCount++;

            // If it's a subscription payment, update user subscription
            if (isSubscriptionPlan(payment.planType)) {
              user.subscriptionStatus = "active";
              user.subscriptionPlan = payment.planType;
              if (payment.stripeCustomerId) {
                user.stripeCustomerId = payment.stripeCustomerId;
              }

              // Handle credits with rollover for professional plans
              const creditsForPlan = await getCreditsForPlan(payment.planType);
              const maxRollover = await getMaxRolloverCredits(payment.planType);
              const currentCredits = user.matchCredits || 0;

              if (maxRollover > 0 && currentCredits > 0) {
                const rolloverCredits = Math.min(currentCredits, maxRollover);
                user.matchCredits = creditsForPlan + rolloverCredits;
              } else {
                user.matchCredits = creditsForPlan;
              }

              const now = new Date();
              if (
                payment.planType === "starter_monthly" ||
                payment.planType === "professional_monthly"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setMonth(expiryDate.getMonth() + 1);
                user.subscriptionExpiresAt = expiryDate;
              } else if (
                payment.planType === "starter_annual" ||
                payment.planType === "professional_annual"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                user.subscriptionExpiresAt = expiryDate;
              }
              subscriptionUpdated = true;
            }

            // Handle extra_credit payments (add credits)
            if (payment.planType === "extra_credit") {
              const userEmail = payment.email.toLowerCase().trim();
              let user = await User.findOne({ email: userEmail });
              if (user) {
                const creditsToAdd = Math.floor(payment.amount / 10); // $10 per credit
                user.matchCredits = (user.matchCredits || 0) + creditsToAdd;
                await user.save();
                console.log(
                  `[syncUserPayments] Added ${creditsToAdd} credit(s) to user ${user._id}. New total: ${user.matchCredits}`
                );
              }
            }

            // Set match report to unlocked after payment if exists
            if (payment.matchReportId) {
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
              }
            }
          }
        } else if (payment.stripeSessionId) {
          // Try to find checkout session by stripeSessionId (most reliable for top-ups)
          try {
            const session = await stripe.checkout.sessions.retrieve(
              payment.stripeSessionId
            );
            if (session.payment_status === "paid") {
              payment.status = "succeeded";
              payment.stripePaymentIntentId = session.payment_intent;
              payment.stripeCustomerId = session.customer;
              payment.stripeSubscriptionId = session.subscription;
              payment.paidAt = new Date();
              await payment.save();
              syncedCount++;

              // Handle extra_credit payments (add credits)
              if (payment.planType === "extra_credit") {
                const userEmail = payment.email.toLowerCase().trim();
                let creditUser = await User.findOne({ email: userEmail });
                if (creditUser) {
                  const quantityFromMetadata = session.metadata?.quantity
                    ? parseInt(session.metadata.quantity)
                    : null;
                  const creditsToAdd =
                    quantityFromMetadata || Math.floor(payment.amount / 10);
                  const creditsBefore = creditUser.matchCredits || 0;
                  creditUser.matchCredits = creditsBefore + creditsToAdd;
                  await creditUser.save();

                  // Create credit transaction record for audit
                  const CreditTransaction = (
                    await import("../../models/customer/CreditTransaction.js")
                  ).default;
                  await CreditTransaction.create({
                    userId: creditUser._id,
                    requestId: payment.requestId || null,
                    matchReportId: payment.matchReportId || null,
                    email: creditUser.email,
                    creditsUsed: creditsToAdd,
                    creditsBefore,
                    creditsAfter: creditUser.matchCredits,
                    transactionType: "added",
                    reason: "top_up",
                    notes: `Credits added from extra_credit payment (${creditsToAdd} credits)`,
                  });

                  console.log(
                    `[syncUserPayments] Added ${creditsToAdd} credit(s) to user ${creditUser._id}. New total: ${creditUser.matchCredits}`
                  );
                }
              }

              // If it's a subscription payment, update user subscription
              if (isSubscriptionPlan(payment.planType)) {
                const userEmail = payment.email.toLowerCase().trim();
                let subscriptionUser = await User.findOne({ email: userEmail });
                if (subscriptionUser) {
                  subscriptionUser.subscriptionStatus = "active";
                  subscriptionUser.subscriptionPlan = payment.planType;
                  if (payment.stripeCustomerId) {
                    subscriptionUser.stripeCustomerId =
                      payment.stripeCustomerId;
                  }
                  if (payment.stripeSubscriptionId) {
                    subscriptionUser.stripeSubscriptionId =
                      payment.stripeSubscriptionId;
                  }

                  // Handle credits with rollover for professional plans
                  const creditsForPlan = await getCreditsForPlan(
                    payment.planType
                  );
                  const maxRollover = await getMaxRolloverCredits(
                    payment.planType
                  );
                  const currentCredits = subscriptionUser.matchCredits || 0;
                  const creditsBefore = currentCredits;

                  if (maxRollover > 0 && currentCredits > 0) {
                    const rolloverCredits = Math.min(
                      currentCredits,
                      maxRollover
                    );
                    subscriptionUser.matchCredits =
                      creditsForPlan + rolloverCredits;
                  } else {
                    subscriptionUser.matchCredits = creditsForPlan;
                  }

                  // Create credit transaction record for audit
                  const CreditTransaction = (
                    await import("../../models/customer/CreditTransaction.js")
                  ).default;
                  await CreditTransaction.create({
                    userId: subscriptionUser._id,
                    requestId: null, // Subscription allocation not tied to specific request
                    matchReportId: null,
                    email: subscriptionUser.email,
                    creditsUsed: subscriptionUser.matchCredits - creditsBefore,
                    creditsBefore,
                    creditsAfter: subscriptionUser.matchCredits,
                    transactionType: "added",
                    reason: "subscription_allocation",
                    notes: `Credits allocated from ${payment.planType} subscription (sync)`,
                  });

                  const now = new Date();
                  if (
                    payment.planType === "starter_monthly" ||
                    payment.planType === "professional_monthly"
                  ) {
                    const expiryDate = new Date(now);
                    expiryDate.setMonth(expiryDate.getMonth() + 1);
                    subscriptionUser.subscriptionExpiresAt = expiryDate;
                  } else if (
                    payment.planType === "starter_annual" ||
                    payment.planType === "professional_annual"
                  ) {
                    const expiryDate = new Date(now);
                    expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                    subscriptionUser.subscriptionExpiresAt = expiryDate;
                  }
                  subscriptionUpdated = true;
                  await subscriptionUser.save();
                }
              }

              // Set match report to unlocked after payment if exists
              if (payment.matchReportId) {
                const matchReport = await MatchReport.findById(
                  payment.matchReportId
                );
                if (matchReport && matchReport.status !== "unlocked") {
                  matchReport.status = "unlocked";
                  matchReport.paymentId = payment._id.toString();
                  matchReport.unlockedAt = new Date();
                  await matchReport.save();
                }
              }
            }
          } catch (sessionError) {
            console.error(
              `[syncUserPayments] Error retrieving session ${payment.stripeSessionId}:`,
              sessionError
            );
          }
        } else {
          // Try to find checkout session by listing (fallback)
          // Note: We list recent sessions and filter in-memory because listing by client_reference_id
          // or metadata is not directly supported in the list API
          const sessions = await stripe.checkout.sessions.list({
            limit: 100,
          });

          const matchingSession = sessions.data.find(
            (s) =>
              (payment.requestId &&
                s.client_reference_id === payment.requestId.toString() &&
                s.payment_status === "paid") ||
              (payment.stripeSessionId &&
                s.id === payment.stripeSessionId &&
                s.payment_status === "paid")
          );

          if (matchingSession) {
            payment.status = "succeeded";
            payment.stripePaymentIntentId = matchingSession.payment_intent;
            payment.stripeCustomerId = matchingSession.customer;
            payment.stripeSubscriptionId = matchingSession.subscription;
            payment.paidAt = new Date();
            await payment.save();
            syncedCount++;

            // Handle extra_credit payments (add credits)
            if (payment.planType === "extra_credit") {
              const userEmail = payment.email.toLowerCase().trim();
              let creditUser = await User.findOne({ email: userEmail });
              if (creditUser) {
                const quantityFromMetadata = matchingSession.metadata?.quantity
                  ? parseInt(matchingSession.metadata.quantity)
                  : null;
                const creditsToAdd =
                  quantityFromMetadata || Math.floor(payment.amount / 10);
                creditUser.matchCredits =
                  (creditUser.matchCredits || 0) + creditsToAdd;
                await creditUser.save();
                console.log(
                  `[syncUserPayments] Added ${creditsToAdd} credit(s) to user ${creditUser._id}. New total: ${creditUser.matchCredits}`
                );
              }
            }

            // If it's a subscription payment, update user subscription
            if (isSubscriptionPlan(payment.planType)) {
              const userEmail = payment.email.toLowerCase().trim();
              let subscriptionUser = await User.findOne({ email: userEmail });
              if (subscriptionUser) {
                subscriptionUser.subscriptionStatus = "active";
                subscriptionUser.subscriptionPlan = payment.planType;
                subscriptionUser.stripeCustomerId = matchingSession.customer;
                subscriptionUser.stripeSubscriptionId =
                  matchingSession.subscription;

                // Handle credits with rollover for professional plans
                const creditsForPlan = await getCreditsForPlan(
                  payment.planType
                );
                const maxRollover = await getMaxRolloverCredits(
                  payment.planType
                );
                const currentCredits = subscriptionUser.matchCredits || 0;
                const creditsBefore = currentCredits;

                if (maxRollover > 0 && currentCredits > 0) {
                  const rolloverCredits = Math.min(currentCredits, maxRollover);
                  subscriptionUser.matchCredits =
                    creditsForPlan + rolloverCredits;
                } else {
                  subscriptionUser.matchCredits = creditsForPlan;
                }

                // Create credit transaction record for audit
                const CreditTransaction = (
                  await import("../../models/customer/CreditTransaction.js")
                ).default;
                await CreditTransaction.create({
                  userId: subscriptionUser._id,
                  requestId: null, // Subscription allocation not tied to specific request
                  matchReportId: null,
                  email: subscriptionUser.email,
                  creditsUsed: subscriptionUser.matchCredits - creditsBefore,
                  creditsBefore,
                  creditsAfter: subscriptionUser.matchCredits,
                  transactionType: "added",
                  reason: "subscription_allocation",
                  notes: `Credits allocated from ${payment.planType} subscription (sync from session list)`,
                });

                const now = new Date();
                if (
                  payment.planType === "starter_monthly" ||
                  payment.planType === "professional_monthly"
                ) {
                  const expiryDate = new Date(now);
                  expiryDate.setMonth(expiryDate.getMonth() + 1);
                  subscriptionUser.subscriptionExpiresAt = expiryDate;
                } else if (
                  payment.planType === "starter_annual" ||
                  payment.planType === "professional_annual"
                ) {
                  const expiryDate = new Date(now);
                  expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                  subscriptionUser.subscriptionExpiresAt = expiryDate;
                }
                subscriptionUpdated = true;
                await subscriptionUser.save();
              }
            }

            // Set match report to unlocked after payment if exists
            if (payment.matchReportId) {
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
              }
            }
          }
        }
      } catch (syncError) {
        console.error(
          `[syncUserPayments] Error syncing payment ${payment._id}:`,
          syncError
        );
      }
    }

    // Save user if subscription was updated
    if (subscriptionUpdated) {
      await user.save();
      console.log(
        `[syncUserPayments] Updated user subscription: ${user.subscriptionPlan}`
      );
    }

    res.json({
      success: true,
      message: `Synced ${syncedCount} payment(s)`,
      data: {
        syncedCount,
        subscriptionUpdated,
      },
    });
  } catch (error) {
    console.error("Error syncing user payments:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Manual unlock (for testing/mock payments)
export const manualUnlock = async (req, res) => {
  try {
    const { requestId } = req.params;

    const matchReport = await MatchReport.findOne({ requestId });
    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    // Check if already unlocked
    if (matchReport.status === "unlocked") {
      return res.json({
        success: true,
        message: "Report already unlocked",
      });
    }

    // Create mock payment for development
    const payment = new Payment({
      requestId,
      matchReportId: matchReport._id,
      email: matchReport.email || "test@example.com",
      amount: 49,
      planType: "one-time",
      status: "succeeded",
      paidAt: new Date(),
    });
    await payment.save();

    // Unlock report
    matchReport.status = "unlocked";
    matchReport.paymentId = payment._id.toString();
    matchReport.unlockedAt = new Date();
    await matchReport.save();

    res.json({
      success: true,
      message: "Report unlocked successfully (mock payment)",
    });
  } catch (error) {
    console.error("Error manually unlocking:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
