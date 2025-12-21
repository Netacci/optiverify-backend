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
 * Get all transactions (receipts) for the current user with pagination
 */
export const getAllReceipts = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const receipts = [];

    // Get all payment receipts (including savings fee payments)
    // First, get payments by email match
    const paymentsByEmail = await Payment.find({
      email: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') },
      status: "succeeded",
    })
      .populate({
        path: "requestId",
        options: { strictPopulate: false }, // Allow null requestId (for top-up payments)
      })
      .sort({ createdAt: -1 });

    // Also get all managed service payments and filter by ownership
    const allManagedServicePayments = await Payment.find({
      planType: { $in: ["managed_service", "managed_service_savings_fee"] },
      status: "succeeded",
    })
      .sort({ createdAt: -1 });

    // Filter managed service payments to only those owned by this user
    const userManagedServicePayments = [];
    for (const payment of allManagedServicePayments) {
      if (payment.requestId) {
        const managedService = await ManagedService.findById(payment.requestId);
        if (managedService && (
          managedService.userId?.toString() === user._id.toString() ||
          managedService.email.toLowerCase() === user.email.toLowerCase()
        )) {
          // Only add if not already in paymentsByEmail
          const alreadyIncluded = paymentsByEmail.some(p => p._id.toString() === payment._id.toString());
          if (!alreadyIncluded) {
            userManagedServicePayments.push(payment);
          }
        }
      }
    }

    // Combine all payments
    const allPayments = [...paymentsByEmail, ...userManagedServicePayments];

    for (const payment of allPayments) {
      if (payment.planType === "managed_service_savings_fee") {
        // Find the managed service for additional details
        const managedService = await ManagedService.findById(payment.requestId);
        receipts.push({
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
          },
        });
      } else if (payment.planType === "extra_credit") {
        // Top-up credit payment
        const quantity = Math.floor(payment.amount / 10); // $10 per credit
        receipts.push({
          id: payment._id,
          type: "top_up",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          credits: quantity,
          description: `Top-up: ${quantity} credit${quantity > 1 ? 's' : ''}`,
        });
      } else {
        receipts.push({
          id: payment._id,
          type: payment.planType === "managed_service" ? "managed_service" : "match_report",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          request: {
            id: payment.requestId?._id || payment.requestId,
            category: payment.requestId?.category,
          },
        });
      }
    }

    // Get managed service receipts
    const managedServices = await ManagedService.find({
      $or: [
        { userId: user._id },
        { email: { $regex: new RegExp(`^${user.email.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`, 'i') } }
      ],
      serviceFeeStatus: "paid",
    }).sort({ createdAt: -1 });

    for (const service of managedServices) {
      receipts.push({
        id: service._id,
        type: "managed_service",
        amount: service.serviceFeeAmount,
        currency: "usd",
        paidAt: service.serviceFeePaidAt || service.createdAt,
        createdAt: service.createdAt,
        service: {
          id: service._id,
          category: service.category,
        },
      });
    }

    // Sort all receipts by date (newest first)
    receipts.sort((a, b) => new Date(b.paidAt) - new Date(a.paidAt));

    // Paginate
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

