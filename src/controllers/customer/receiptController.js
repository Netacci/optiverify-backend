import Payment from "../../models/customer/Payment.js";
import ManagedService from "../../models/customer/ManagedService.js";
import MatchReport from "../../models/customer/MatchReport.js";
import BuyerRequest from "../../models/customer/BuyerRequest.js";
import User from "../../models/common/User.js";
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
 * Get receipt for a regular payment (match report)
 */
export const getPaymentReceipt = async (req, res) => {
  try {
    const { paymentId } = req.params;
    const user = await User.findById(req.user._id);

    // Find payment and verify ownership
    const payment = await Payment.findOne({
      _id: paymentId,
      email: user.email.toLowerCase(),
      status: "succeeded",
    })
      .populate("requestId")
      .populate("matchReportId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment not found or access denied",
      });
    }

    // Get Stripe payment details if available
    let stripeDetails = null;
    if (payment.stripePaymentIntentId && stripe) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId
        );
        stripeDetails = {
          paymentIntentId: paymentIntent.id,
          receiptUrl: paymentIntent.charges?.data[0]?.receipt_url || null,
          billingDetails: paymentIntent.charges?.data[0]?.billing_details || null,
        };
      } catch (stripeError) {
        console.error("Error fetching Stripe details:", stripeError);
      }
    }

    // Format receipt data
    const receipt = {
      id: payment._id,
      type: "match_report",
      amount: payment.amount,
      currency: payment.currency || "usd",
      planType: payment.planType,
      paidAt: payment.paidAt || payment.createdAt,
      createdAt: payment.createdAt,
      request: {
        id: payment.requestId._id,
        category: payment.requestId.category,
        specifications: payment.requestId.specifications,
      },
      matchReport: {
        id: payment.matchReportId._id,
        status: payment.matchReportId.status,
      },
      stripe: stripeDetails,
    };

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Error fetching payment receipt:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get receipt for a managed service payment
 */
export const getManagedServiceReceipt = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const user = await User.findById(req.user._id);

    // Find managed service and verify ownership
    const managedService = await ManagedService.findOne({
      _id: serviceId,
      $or: [
        { userId: user._id },
        { email: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ],
      serviceFeeStatus: "paid",
    });

    if (!managedService) {
      return res.status(404).json({
        success: false,
        message: "Managed service not found or access denied",
      });
    }

    // Get Stripe payment details
    let stripeDetails = null;
    if (managedService.serviceFeePaymentId && stripe) {
      try {
        // Check if it's a payment intent ID or checkout session ID
        let paymentIntent;
        try {
          // Try as payment intent first
          paymentIntent = await stripe.paymentIntents.retrieve(
            managedService.serviceFeePaymentId
          );
        } catch (e) {
          // If that fails, try as checkout session
          const session = await stripe.checkout.sessions.retrieve(
            managedService.serviceFeePaymentId
          );
          if (session.payment_intent) {
            paymentIntent = await stripe.paymentIntents.retrieve(
              session.payment_intent
            );
          } else {
            throw new Error("No payment intent found");
          }
        }

        stripeDetails = {
          paymentIntentId: paymentIntent.id,
          receiptUrl: paymentIntent.charges?.data[0]?.receipt_url || null,
          billingDetails: paymentIntent.charges?.data[0]?.billing_details || null,
        };
      } catch (stripeError) {
        console.error("Error fetching Stripe details:", stripeError);
      }
    }

    // Format receipt data
    const receipt = {
      id: managedService._id,
      type: "managed_service",
      amount: managedService.serviceFeeAmount,
      currency: "usd",
      paidAt: managedService.serviceFeePaidAt || managedService.createdAt,
      createdAt: managedService.createdAt,
      service: {
        id: managedService._id,
        category: managedService.category,
        specifications: managedService.specifications,
        quantity: managedService.quantity,
        deliveryLocation: managedService.deliveryLocation,
      },
      stripe: stripeDetails,
    };

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Error fetching managed service receipt:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get receipt for a managed service savings fee payment
 */
export const getManagedServiceSavingsFeeReceipt = async (req, res) => {
  try {
    const { serviceId } = req.params;
    const user = await User.findById(req.user._id);

    // Find managed service and verify ownership
    const managedService = await ManagedService.findOne({
      _id: serviceId,
      $or: [
        { userId: user._id },
        { email: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ],
      savingsFeeStatus: "paid",
    });

    if (!managedService) {
      return res.status(404).json({
        success: false,
        message: "Managed service not found or savings fee not paid",
      });
    }

    // Find the Payment record for savings fee
    const payment = await Payment.findOne({
      requestId: managedService._id,
      planType: "managed_service_savings_fee",
      status: "succeeded",
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Payment record not found",
      });
    }

    // Get Stripe payment details
    let stripeDetails = null;
    if (payment.stripePaymentIntentId && stripe) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId
        );

        stripeDetails = {
          paymentIntentId: paymentIntent.id,
          receiptUrl: paymentIntent.charges?.data[0]?.receipt_url || null,
          billingDetails: paymentIntent.charges?.data[0]?.billing_details || null,
        };
      } catch (stripeError) {
        console.error("Error fetching Stripe details:", stripeError);
      }
    }

    // Format receipt data
    const receipt = {
      id: payment._id,
      type: "managed_service_savings_fee",
      amount: managedService.savingsFeeAmount,
      currency: "usd",
      paidAt: managedService.savingsFeePaidAt || payment.paidAt,
      createdAt: payment.createdAt,
      service: {
        id: managedService._id,
        category: managedService.category,
        savingsAmount: managedService.savingsAmount,
        savingsFeePercentage: managedService.savingsFeePercentage,
      },
      stripe: stripeDetails,
    };

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Error fetching savings fee receipt:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get a single transaction receipt by ID
 */
export const getReceiptById = async (req, res) => {
  try {
    const { transactionId } = req.params;
    const user = await User.findById(req.user._id);

    // Find the payment record — do NOT populate requestId because for managed service payments
    // it points to a ManagedService (not a BuyerRequest), and populate would set it to null.
    const payment = await Payment.findOne({
      _id: transactionId,
      status: "succeeded",
    });

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Verify user owns this transaction
    const isOwner =
      payment.email.toLowerCase() === user.email.toLowerCase();

    if (!isOwner) {
      // For managed services, also check ownership through the managed service
      if (
        payment.planType === "managed_service" ||
        payment.planType === "managed_service_savings_fee"
      ) {
        if (payment.requestId) {
          const managedService = await ManagedService.findById(payment.requestId);
          if (
            !managedService ||
            (managedService.userId?.toString() !== user._id.toString() &&
              managedService.email.toLowerCase() !== user.email.toLowerCase())
          ) {
            return res.status(403).json({
              success: false,
              message: "Access denied",
            });
          }
        } else {
          return res.status(403).json({
            success: false,
            message: "Access denied",
          });
        }
      } else {
        return res.status(403).json({
          success: false,
          message: "Access denied",
        });
      }
    }

    // Get Stripe payment details if available
    let stripeDetails = null;
    if (payment.stripePaymentIntentId && stripe) {
      try {
        const paymentIntent = await stripe.paymentIntents.retrieve(
          payment.stripePaymentIntentId
        );
        stripeDetails = {
          paymentIntentId: paymentIntent.id,
          receiptUrl: paymentIntent.charges?.data[0]?.receipt_url || null,
          billingDetails: paymentIntent.charges?.data[0]?.billing_details || null,
        };
      } catch (stripeError) {
        console.error("Error fetching Stripe details:", stripeError);
      }
    }

    // Format receipt data based on type
    let receipt;

    if (payment.planType === "managed_service_savings_fee") {
      const managedService = await ManagedService.findById(payment.requestId);
      receipt = {
        id: payment._id,
        type: "managed_service_savings_fee",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        service: {
          id: managedService?._id,
          category: managedService?.category,
          savingsAmount: managedService?.savingsAmount,
          savingsFeePercentage: managedService?.savingsFeePercentage,
        },
        stripe: stripeDetails,
      };
    } else if (payment.planType === "extra_credit") {
      const quantity = Math.floor(payment.amount / 10);
      receipt = {
        id: payment._id,
        type: "top_up",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        credits: quantity,
        description: `Top-up: ${quantity} credit${quantity > 1 ? 's' : ''}`,
        stripe: stripeDetails,
      };
    } else if (payment.planType === "managed_service") {
      const managedService = await ManagedService.findById(payment.requestId);
      receipt = {
        id: payment._id,
        type: "managed_service",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        service: {
          id: payment.requestId,
          itemName: managedService?.itemName,
          category: managedService?.category,
        },
        stripe: stripeDetails,
      };
    } else {
      // match_report — manually look up related docs since we removed populate above
      const buyerRequest = payment.requestId
        ? await BuyerRequest.findById(payment.requestId).lean()
        : null;
      const matchReport = payment.matchReportId
        ? await MatchReport.findById(payment.matchReportId).lean()
        : null;
      receipt = {
        id: payment._id,
        type: "match_report",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        request: {
          id: buyerRequest?._id || payment.requestId,
          name: buyerRequest?.name,
          category: buyerRequest?.category,
          specifications: buyerRequest?.specifications,
        },
        matchReport: {
          id: matchReport?._id,
          status: matchReport?.status,
        },
        stripe: stripeDetails,
      };
    }

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Error fetching receipt by ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get all transactions (receipts) for the current user with pagination.
 *
 * Performance: uses batch queries instead of per-payment DB calls.
 * Total DB round trips: 4 (user + payments by email + user's managed service IDs +
 * extra MS payments) + 3 parallel batch lookups (BuyerRequests, ManagedServices,
 * MatchReports) regardless of how many payments exist.
 */
export const getAllReceipts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id).select("email _id").lean();
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const emailRegex = new RegExp(
      `^${user.email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
      "i"
    );

    // 1. Payments directly on the user's email
    const paymentsByEmail = await Payment.find({
      email: { $regex: emailRegex },
      status: "succeeded",
    })
      .sort({ createdAt: -1 })
      .lean();

    const emailPaymentIds = new Set(paymentsByEmail.map((p) => p._id.toString()));

    // 2. Find managed services owned by this user (by userId OR email) — single query
    const userManagedServices = await ManagedService.find({
      $or: [
        { userId: user._id },
        { email: { $regex: emailRegex } },
      ],
    })
      .select("_id")
      .lean();

    const userMSIds = userManagedServices.map((s) => s._id);

    // 3. Find MS payments for those IDs not already covered by email match
    let extraMSPayments = [];
    if (userMSIds.length > 0) {
      const msPayments = await Payment.find({
        planType: { $in: ["managed_service", "managed_service_savings_fee"] },
        requestId: { $in: userMSIds },
        status: "succeeded",
      })
        .sort({ createdAt: -1 })
        .lean();

      extraMSPayments = msPayments.filter(
        (p) => !emailPaymentIds.has(p._id.toString())
      );
    }

    const allPayments = [...paymentsByEmail, ...extraMSPayments];

    if (allPayments.length === 0) {
      return res.json({
        success: true,
        data: {
          transactions: [],
          pagination: { page, limit, total: 0, totalPages: 0 },
        },
      });
    }

    // 4. Collect IDs for batch lookups — one query per collection, all in parallel
    const brIds = [];
    const msIds = [];
    const mrIds = [];

    for (const p of allPayments) {
      if (
        p.planType === "managed_service" ||
        p.planType === "managed_service_savings_fee"
      ) {
        if (p.requestId) msIds.push(p.requestId);
      } else if (p.planType !== "extra_credit") {
        if (p.requestId) brIds.push(p.requestId);
        if (p.matchReportId) mrIds.push(p.matchReportId);
      }
    }

    const [buyerRequests, managedServices, matchReports] = await Promise.all([
      brIds.length > 0
        ? BuyerRequest.find({ _id: { $in: brIds } })
            .select("name category")
            .lean()
        : [],
      msIds.length > 0
        ? ManagedService.find({ _id: { $in: msIds } })
            .select("itemName category savingsAmount savingsFeePercentage")
            .lean()
        : [],
      mrIds.length > 0
        ? MatchReport.find({ _id: { $in: mrIds } }).select("status").lean()
        : [],
    ]);

    // Build O(1) lookup maps
    const brMap = Object.fromEntries(
      buyerRequests.map((r) => [r._id.toString(), r])
    );
    const msMap = Object.fromEntries(
      managedServices.map((s) => [s._id.toString(), s])
    );
    const mrMap = Object.fromEntries(
      matchReports.map((m) => [m._id.toString(), m])
    );

    // 5. Build receipts using in-memory maps — no more per-payment DB calls
    const receipts = allPayments.map((payment) => {
      const ridStr = payment.requestId?.toString();
      const mridStr = payment.matchReportId?.toString();

      if (payment.planType === "managed_service_savings_fee") {
        const ms = msMap[ridStr];
        return {
          id: payment._id,
          type: "managed_service_savings_fee",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
          service: {
            id: ms?._id,
            itemName: ms?.itemName,
            category: ms?.category,
          },
        };
      }

      if (payment.planType === "extra_credit") {
        const quantity = Math.floor(payment.amount / 10);
        return {
          id: payment._id,
          type: "top_up",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
          credits: quantity,
          description: `Top-up: ${quantity} credit${quantity > 1 ? "s" : ""}`,
        };
      }

      if (payment.planType === "managed_service") {
        const ms = msMap[ridStr];
        return {
          id: payment._id,
          type: "managed_service",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
          service: {
            id: payment.requestId,
            itemName: ms?.itemName,
            category: ms?.category,
          },
        };
      }

      // match_report (and subscription plan types)
      const br = brMap[ridStr];
      const mr = mrMap[mridStr];
      return {
        id: payment._id,
        type: "match_report",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        request: {
          id: br?._id || payment.requestId,
          name: br?.name,
          category: br?.category,
        },
        matchReport: {
          id: mr?._id,
          status: mr?.status,
        },
      };
    });

    // Sort newest first, then paginate in memory
    receipts.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));
    const total = receipts.length;
    const paginatedReceipts = receipts.slice(skip, skip + limit);

    res.json({
      success: true,
      data: {
        transactions: paginatedReceipts,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error fetching all receipts:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

