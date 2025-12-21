import BuyerRequest from "../../models/customer/BuyerRequest.js";
import MatchReport from "../../models/customer/MatchReport.js";
import Payment from "../../models/customer/Payment.js";
import User from "../../models/common/User.js";
import CreditTransaction from "../../models/customer/CreditTransaction.js";
import Stripe from "stripe";

// Initialize Stripe only if valid key is provided
const getStripeInstance = () => {
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (
    !stripeKey ||
    stripeKey.includes("dummy") ||
    stripeKey === "sk_test_dummy_key_replace_with_real_key"
  ) {
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
 * Get user's requests
 */
export const getUserRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user._id).select("-password");

    // Get all payments for this user (case-insensitive email match)
    const userEmail = user.email.toLowerCase().trim();

    // First, try to sync any pending payments
    if (stripe) {
      const pendingPayments = await Payment.find({
        email: {
          $regex: new RegExp(
            `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        },
        status: "pending",
      });

      for (const payment of pendingPayments) {
        try {
          // Try to sync by payment intent if available
          if (payment.stripePaymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              payment.stripePaymentIntentId
            );
            if (paymentIntent.status === "succeeded") {
              payment.status = "succeeded";
              payment.paidAt = new Date();
              await payment.save();

              // Unlock match report
              // const matchReport = await MatchReport.findById(
              //   payment.matchReportId
              // );
              // if (matchReport && matchReport.status !== "unlocked") {
              //   matchReport.status = "unlocked";
              //   matchReport.paymentId = payment._id.toString();
              //   matchReport.unlockedAt = new Date();
              //   await matchReport.save();
              // }
              // Set match report to unlocked after payment
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
              }
              console.log(
                `[getUserRequests] Auto-synced payment ${payment._id} to succeeded`
              );
            }
          } else {
            // Try to find checkout session by requestId
            const sessions = await stripe.checkout.sessions.list({
              limit: 100,
            });

            const matchingSession = sessions.data.find(
              (s) =>
                payment.requestId &&
                s.client_reference_id === payment.requestId.toString() &&
                s.payment_status === "paid"
            );

            if (matchingSession && matchingSession.payment_intent) {
              payment.stripePaymentIntentId = matchingSession.payment_intent;
              payment.stripeCustomerId = matchingSession.customer;
              payment.status = "succeeded";
              payment.paidAt = new Date();
              await payment.save();

              // Unlock match report
              // const matchReport = await MatchReport.findById(
              //   payment.matchReportId
              // );
              // if (matchReport && matchReport.status !== "unlocked") {
              //   matchReport.status = "unlocked";
              //   matchReport.paymentId = payment._id.toString();
              //   matchReport.unlockedAt = new Date();
              //   await matchReport.save();
              // }
              // Set match report to unlocked after payment
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
              }
              console.log(
                `[getUserRequests] Auto-synced payment ${payment._id} from checkout session`
              );
            }
          }
        } catch (syncError) {
          console.error(
            `[getUserRequests] Error syncing payment ${payment._id}:`,
            syncError
          );
          // Continue with other payments even if one fails
        }
      }
    }

    // Filter based on subscription type
    // If user has subscription, they see all payments/requests.
    // If user has one-time payments, they see those.
    // We actually want to show ALL requests, regardless of payment status, so they can unlock them.
    // BUT current logic gets payments first, which implies only paid requests are fetched.

    // NEW LOGIC: Fetch ALL BuyerRequests for this user, then attach status/payment info.
    const allBuyerRequests = await BuyerRequest.find({ email: userEmail }).sort(
      { createdAt: -1 }
    );

    // Get Request IDs
    const requestIds = allBuyerRequests.map((r) => r._id);

    // Fetch related match reports
    const matchReports = await MatchReport.find({
      requestId: { $in: requestIds },
    });

    // Fetch related payments (succeeded only to check paid status)
    const succeededPayments = await Payment.find({
      email: {
        $regex: new RegExp(
          `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
      },
      status: "succeeded",
      requestId: { $in: requestIds },
    });

    // Format response
    const allRequests = allBuyerRequests.map((request) => {
      const report = matchReports.find(
        (mr) => mr.requestId.toString() === request._id.toString()
      );
      const payment = succeededPayments.find(
        (p) => p.requestId.toString() === request._id.toString()
      );

      // Determine status:
      // If report exists and is 'unlocked', then 'completed' (viewable)
      // If payment exists, then 'completed' (viewable)
      // If report exists and is 'completed' AND user has active subscription -> 'completed' (credits were used)
      // If report exists but 'completed' (not unlocked, no active sub) -> 'pending_payment'
      // If no report -> 'processing' or 'pending'

      let status = request.status;
      let matchScore = 0;
      let matchedCount = 0;
      let matchReportStatus = null;

      // Check if user has active subscription
      const hasActiveSubscription =
        user.subscriptionStatus === "active" &&
        (!user.subscriptionExpiresAt ||
          new Date(user.subscriptionExpiresAt) > new Date());

      if (report) {
        matchScore = report.preview?.matchScore || 0;
        matchedCount = report.preview?.matchedCount || 0;
        matchReportStatus = report.status; // 'pending', 'completed', 'unlocked'

        if (report.status === "unlocked" || payment) {
          status = "completed"; // Unlocked and viewable
        } else if (report.status === "completed" && hasActiveSubscription) {
          // Match report is completed and user has active subscription (credits were used)
          status = "completed";
        } else if (report.status === "completed") {
          status = "pending_payment"; // Generated but locked (no active subscription)
        }
      }

      return {
        requestId: request._id,
        category: request.category,
        description: request.description,
        quantity: request.quantity,
        budget: request.budget,
        timeline: request.timeline,
        location: request.location,
        matchedCount,
        matchScore,
        status, // 'pending', 'processing', 'pending_payment', 'completed'
        matchReportStatus, // 'pending', 'completed', 'unlocked', or null
        planType: payment?.planType,
        paidAt: payment?.paidAt,
        createdAt: request.createdAt,
      };
    });

    // Apply pagination
    const total = allRequests.length;
    const requests = allRequests.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        requests,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
        subscriptionPlan: user.subscriptionPlan,
        subscriptionStatus: user.subscriptionStatus,
      },
    });
  } catch (error) {
    console.error("Error getting user requests:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Unlock a request using a match credit
 */
export const unlockRequest = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const BuyerRequest = (await import("../../models/customer/BuyerRequest.js"))
      .default;

    // Check request ownership
    const request = await BuyerRequest.findOne({ _id: id, email: user.email });
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Check match report
    const matchReport = await MatchReport.findOne({ requestId: id });
    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    if (matchReport.status === "unlocked") {
      return res.json({
        success: true,
        message: "Request already unlocked",
      });
    }

    // Check credits
    if (!user.matchCredits || user.matchCredits < 1) {
      return res.status(400).json({
        success: false,
        message: "Insufficient match credits",
        code: "NO_CREDITS",
      });
    }

    // Decrement credits and unlock
    const creditsBefore = user.matchCredits;
    user.matchCredits -= 1;
    await user.save();

    // Create credit transaction record for audit
    const CreditTransaction = (
      await import("../../models/customer/CreditTransaction.js")
    ).default;
    await CreditTransaction.create({
      userId: user._id,
      requestId: id,
      matchReportId: matchReport._id,
      email: user.email,
      creditsUsed: 1,
      creditsBefore,
      creditsAfter: user.matchCredits,
      transactionType: "deducted",
      reason: "unlock_request",
      notes: "Credit used to unlock request",
    });

    matchReport.status = "unlocked";
    matchReport.unlockedAt = new Date();
    await matchReport.save();

    res.json({
      success: true,
      message: "Request unlocked successfully",
      creditsRemaining: user.matchCredits,
    });
  } catch (error) {
    console.error("Error unlocking request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get single request with full match details
 */
export const getRequestDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const user = req.user;
    const BuyerRequest = (await import("../../models/customer/BuyerRequest.js"))
      .default;

    // First check if the request belongs to the user
    const request = await BuyerRequest.findOne({ _id: id, email: user.email });
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Get match report
    const matchReport = await MatchReport.findOne({ requestId: id }).populate(
      "fullReport.suppliers.supplierId"
    );

    // If no match report exists, return request data with pending status
    // This happens when request was created on homepage but matching hasn't been processed yet
    if (!matchReport) {
      return res.json({
        success: true,
        data: {
          request: {
            id: request._id,
            name: request.name,
            category: request.category,
            description: request.description,
            unitPrice: request.unitPrice,
            totalAmount: request.totalAmount,
            quantity: request.quantity,
            timeline: request.timeline,
            location: request.location,
            requirements: request.requirements,
            status: request.status,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          },
          suppliers: [], // No suppliers yet
          isLocked: true,
          status: "pending",
          matchReportStatus: "pending", // No match report yet, treat as pending
        },
      });
    }

    // Check access:
    // 1. If report is completed (AI matching done)
    // 2. OR if report is unlocked (after payment, waiting for AI matching)
    // 3. OR if payment exists (legacy/fallback)
    let hasAccess = matchReport.status === "completed";
    let isUnlocked = matchReport.status === "unlocked";
    let isPending = matchReport.status === "pending";

    if (!hasAccess) {
      const payment = await Payment.findOne({
        email: user.email,
        requestId: id,
        status: "succeeded",
      });
      if (payment) {
        // If payment exists and report is unlocked, user can generate AI match
        if (isUnlocked) {
          hasAccess = false; // Still locked, but show generate button
        } else {
          hasAccess = true;
        }
      }
    }

    // If pending (no payment yet), return request data with pending status
    if (isPending) {
      return res.json({
        success: true,
        data: {
          request: {
            id: request._id,
            name: request.name,
            category: request.category || matchReport.preview?.category,
            description: request.description || matchReport.preview?.summary,
            unitPrice: request.unitPrice,
            totalAmount: request.totalAmount,
            quantity: request.quantity,
            timeline: request.timeline,
            location: request.location,
            requirements: request.requirements,
            status: request.status,
            matchedCount: matchReport.preview?.matchedCount || 0,
            matchScore: matchReport.preview?.matchScore || 0,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          },
          suppliers: [], // Empty suppliers for pending view
          isLocked: true,
          status: "pending",
          matchReportStatus: "pending",
          generatedAt: matchReport.fullReport?.generatedAt,
        },
      });
    }

    if (!hasAccess && !isUnlocked) {
      // Return 200 with limited data and isLocked flag
      return res.json({
        success: true,
        data: {
          request: {
            id: request._id,
            name: request.name,
            category: request.category || matchReport.preview.category,
            description: request.description || matchReport.preview.summary,
            unitPrice: request.unitPrice,
            totalAmount: request.totalAmount,
            quantity: request.quantity,
            timeline: request.timeline,
            location: request.location,
            requirements: request.requirements,
            status: request.status,
            matchedCount: matchReport.preview.matchedCount,
            matchScore: matchReport.preview.matchScore,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          },
          suppliers: [], // Empty suppliers for locked view
          isLocked: true,
          status: "pending_payment",
          matchReportStatus: matchReport.status,
          generatedAt: matchReport.fullReport?.generatedAt,
        },
      });
    }

    // If unlocked, return with unlocked status so frontend can show generate button
    if (isUnlocked && !hasAccess) {
      return res.json({
        success: true,
        data: {
          request: {
            id: request._id,
            name: request.name,
            category: request.category || matchReport.preview.category,
            description: request.description || matchReport.preview.summary,
            unitPrice: request.unitPrice,
            totalAmount: request.totalAmount,
            quantity: request.quantity,
            timeline: request.timeline,
            location: request.location,
            requirements: request.requirements,
            status: request.status,
            matchedCount: matchReport.preview?.matchedCount || 0,
            matchScore: matchReport.preview?.matchScore || 0,
            createdAt: request.createdAt,
            updatedAt: request.updatedAt,
          },
          suppliers: [], // Empty suppliers until AI match is generated
          isLocked: true,
          status: "unlocked",
          matchReportStatus: "unlocked",
          generatedAt: matchReport.fullReport?.generatedAt,
        },
      });
    }

    // Format suppliers

    // Format suppliers
    const suppliers = matchReport.fullReport.suppliers.map((item) => {
      const supplier = item.supplierId;
      return {
        name: supplier.name,
        location: supplier.location,
        email: supplier.email,
        phone: supplier.phone,
        website: supplier.website,
        certifications: supplier.certifications,
        leadTime: supplier.leadTime,
        minOrderQuantity: supplier.minOrderQuantity,
        capabilities: supplier.capabilities,
        description: supplier.description,
        matchScore: item.matchScore,
        ranking: item.ranking,
        whyTheyMatch: item.whyTheyMatch,
        aiExplanation: item.aiExplanation,
        strengths: item.strengths || [],
        concerns: item.concerns || [],
      };
    });

    res.json({
      success: true,
      data: {
        request: {
          id: request._id,
          name: request.name,
          category: request.category || matchReport.preview.category,
          description: request.description || matchReport.preview.summary,
          unitPrice: request.unitPrice,
          totalAmount: request.totalAmount,
          quantity: request.quantity,
          timeline: request.timeline,
          location: request.location,
          requirements: request.requirements,
          status: request.status,
          matchedCount: matchReport.preview.matchedCount,
          matchScore: matchReport.preview.matchScore,
          createdAt: request.createdAt,
          updatedAt: request.updatedAt,
        },
        suppliers,
        isLocked: false,
        status: matchReport.status,
        matchReportStatus: matchReport.status,
        generatedAt: matchReport.fullReport.generatedAt,
      },
    });
  } catch (error) {
    console.error("Error getting request details:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Check subscription status
 */
export const getSubscriptionStatus = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("-password");

    const isActive =
      user.subscriptionStatus === "active" &&
      (!user.subscriptionExpiresAt ||
        new Date(user.subscriptionExpiresAt) > new Date());

    res.json({
      success: true,
      data: {
        subscriptionStatus: user.subscriptionStatus || "none",
        planType: user.subscriptionPlan || null,
        subscriptionExpiresAt: user.subscriptionExpiresAt || null,
        matchCredits: user.matchCredits || 0, // Ensure matchCredits is returned
      },
    });
  } catch (error) {
    console.error("Error getting subscription status:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get credit transactions for the current user
 */
export const getCreditTransactions = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const user = await User.findById(req.user._id);

    // Get credit transactions for this user
    const transactions = await CreditTransaction.find({ userId: user._id })
      .populate("requestId", "name category")
      .populate("matchReportId", "status")
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit);

    const total = await CreditTransaction.countDocuments({ userId: user._id });

    res.json({
      success: true,
      data: {
        transactions: transactions.map((t) => ({
          id: t._id,
          requestId: t.requestId?._id || null,
          requestName: t.requestId?.name || null,
          requestCategory: t.requestId?.category || null,
          matchReportId: t.matchReportId?._id || null,
          creditsUsed: t.creditsUsed,
          creditsBefore: t.creditsBefore,
          creditsAfter: t.creditsAfter,
          transactionType: t.transactionType,
          reason: t.reason,
          notes: t.notes,
          createdAt: t.createdAt,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting credit transactions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
