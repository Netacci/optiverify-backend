import User from "../../models/common/User.js";
import Admin from "../../models/admin/Admin.js";
import Feedback from "../../models/customer/Feedback.js";
import Supplier from "../../models/admin/Supplier.js";
import Payment from "../../models/customer/Payment.js";
import ManagedService from "../../models/customer/ManagedService.js";

/**
 * Middleware to check admin access
 */
export const requireAdmin = (req, res, next) => {
  if (
    req.admin &&
    (req.admin.role === "admin" || req.admin.role === "superAdmin")
  ) {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Admin access required",
    });
  }
};

/**
 * Middleware to check super admin access
 */
export const requireSuperAdmin = (req, res, next) => {
  if (req.admin && req.admin.role === "superAdmin") {
    next();
  } else {
    return res.status(403).json({
      success: false,
      message: "Super admin access required",
    });
  }
};

/**
 * Get all users with optional filtering
 */
export const getUsers = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { subscriptionStatus, search } = req.query;
    const query = {};

    // Filter by subscription status
    if (subscriptionStatus && subscriptionStatus !== "all") {
      query.subscriptionStatus = subscriptionStatus;
    }

    // Search by email
    if (search) {
      query.email = { $regex: search, $options: "i" };
    }

    const [users, total] = await Promise.all([
      User.find(query)
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      User.countDocuments(query),
    ]);

    // Check and update subscription status for expired subscriptions
    const { checkAndUpdateMultipleSubscriptions } = await import(
      "../../services/subscriptionService.js"
    );
    const usersWithUpdatedStatus = await checkAndUpdateMultipleSubscriptions(
      users
    );

    res.json({
      success: true,
      data: {
        users: usersWithUpdatedStatus,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting users:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update user (admin only)
 */
export const updateUser = async (req, res) => {
  try {
    const { id } = req.params;
    const { matchCredits, subscriptionStatus, subscriptionPlan } = req.body;

    const updateData = {};
    if (matchCredits !== undefined) {
      updateData.matchCredits = parseInt(matchCredits);
    }
    if (subscriptionStatus) {
      updateData.subscriptionStatus = subscriptionStatus;
    }
    if (subscriptionPlan !== undefined) {
      updateData.subscriptionPlan = subscriptionPlan;
    }

    const user = await User.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    res.json({
      success: true,
      message: "User updated successfully",
      data: user,
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all admins
 */
export const getAdmins = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const [admins, total] = await Promise.all([
      Admin.find()
        .select("-password")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      Admin.countDocuments(),
    ]);

    res.json({
      success: true,
      data: {
        admins,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting admins:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Create admin (super admin only)
 */
export const createAdmin = async (req, res) => {
  try {
    const { email, password, role } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    if (role && !["admin", "superAdmin"].includes(role)) {
      return res.status(400).json({
        success: false,
        message: "Invalid role. Must be 'admin' or 'superAdmin'",
      });
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({
      email: email.toLowerCase().trim(),
    });
    if (existingAdmin) {
      return res.status(400).json({
        success: false,
        message: "Admin with this email already exists",
      });
    }

    // Check if user with this email exists (to prevent conflicts)
    const existingUser = await User.findOne({
      email: email.toLowerCase().trim(),
    });
    if (existingUser) {
      return res.status(400).json({
        success: false,
        message: "A user with this email already exists",
      });
    }

    const admin = await Admin.create({
      email: email.toLowerCase().trim(),
      password,
      role: role || "admin",
    });

    res.status(201).json({
      success: true,
      message: "Admin created successfully",
      data: {
        id: admin._id,
        email: admin.email,
        role: admin.role,
      },
    });
  } catch (error) {
    console.error("Error creating admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update admin (super admin only)
 */
export const updateAdmin = async (req, res) => {
  try {
    const { id } = req.params;
    const { role, password, isActive } = req.body;

    const updateData = {};
    if (role) {
      if (!["admin", "superAdmin"].includes(role)) {
        return res.status(400).json({
          success: false,
          message: "Invalid role. Must be 'admin' or 'superAdmin'",
        });
      }
      updateData.role = role;
    }
    if (password) {
      updateData.password = password;
    }
    if (isActive !== undefined) {
      updateData.isActive = isActive;
    }

    const admin = await Admin.findByIdAndUpdate(id, updateData, {
      new: true,
      runValidators: true,
    }).select("-password");

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.json({
      success: true,
      message: "Admin updated successfully",
      data: {
        id: admin._id,
        email: admin.email,
        role: admin.role,
        isActive: admin.isActive,
      },
    });
  } catch (error) {
    console.error("Error updating admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete admin (super admin only)
 */
export const deleteAdmin = async (req, res) => {
  try {
    const { id } = req.params;

    // Prevent deleting yourself
    if (id === req.admin._id.toString()) {
      return res.status(400).json({
        success: false,
        message: "You cannot delete your own account",
      });
    }

    const admin = await Admin.findByIdAndDelete(id);

    if (!admin) {
      return res.status(404).json({
        success: false,
        message: "Admin not found",
      });
    }

    res.json({
      success: true,
      message: "Admin deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting admin:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get a single transaction by ID (admin - no ownership check)
 */
export const getTransactionByIdAdmin = async (req, res) => {
  try {
    const { transactionId } = req.params;

    // Find the payment record
    const payment = await Payment.findOne({
      _id: transactionId,
      status: "succeeded",
    })
      .populate({
        path: "requestId",
        options: { strictPopulate: false },
      })
      .populate("matchReportId");

    if (!payment) {
      return res.status(404).json({
        success: false,
        message: "Transaction not found",
      });
    }

    // Build receipt based on payment type
    let receipt = null;
    let stripeDetails = null;

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
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        email: payment.email,
        service: {
          id: managedService?._id,
          itemName: managedService?.itemName,
          category: managedService?.category,
          savingsAmount: managedService?.savingsAmount,
          savingsFeePercentage: managedService?.savingsFeePercentage,
        },
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
        email: payment.email,
        credits: quantity,
        description: `Top-up: ${quantity} credit${quantity > 1 ? 's' : ''}`,
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
        email: payment.email,
        service: {
          id: payment.requestId,
          itemName: managedService?.itemName,
          category: managedService?.category,
          finalReport: managedService?.finalReport,
        },
      };
    } else {
      receipt = {
        id: payment._id,
        type: "match_report",
        amount: payment.amount,
        currency: payment.currency || "usd",
        planType: payment.planType,
        paidAt: payment.paidAt || payment.createdAt,
        createdAt: payment.createdAt,
        paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
        email: payment.email,
        request: {
          id: payment.requestId?._id,
          name: payment.requestId?.name,
          category: payment.requestId?.category,
          specifications: payment.requestId?.specifications,
        },
        matchReport: {
          id: payment.matchReportId?._id,
          status: payment.matchReportId?.status,
        },
      };
    }

    res.json({
      success: true,
      data: receipt,
    });
  } catch (error) {
    console.error("Error fetching transaction by ID:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get all transactions from all users (for admin)
 */
export const getAllTransactionsAdmin = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const receipts = [];

    // Get all succeeded payments
    const allPayments = await Payment.find({
      status: "succeeded",
    })
      .populate({
        path: "requestId",
        options: { strictPopulate: false },
      })
      .populate("matchReportId")
      .sort({ createdAt: -1 });

    // Process each payment
    for (const payment of allPayments) {
      if (payment.planType === "managed_service_savings_fee") {
        const managedService = await ManagedService.findById(payment.requestId);
        receipts.push({
          id: payment._id,
          type: "managed_service_savings_fee",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
          email: payment.email,
          service: {
            id: managedService?._id,
            itemName: managedService?.itemName,
            category: managedService?.category,
          },
        });
      } else if (payment.planType === "extra_credit") {
        const quantity = Math.floor(payment.amount / 10);
        receipts.push({
          id: payment._id,
          type: "top_up",
          amount: payment.amount,
          currency: payment.currency || "usd",
          planType: payment.planType,
          paidAt: payment.paidAt || payment.createdAt,
          createdAt: payment.createdAt,
          paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
          email: payment.email,
          credits: quantity,
          description: `Top-up: ${quantity} credit${quantity > 1 ? 's' : ''}`,
        });
      } else {
        // Handle both managed_service and match_report
        if (payment.planType === "managed_service") {
          const managedService = await ManagedService.findById(payment.requestId);
          receipts.push({
            id: payment._id,
            type: "managed_service",
            amount: payment.amount,
            currency: payment.currency || "usd",
            planType: payment.planType,
            paidAt: payment.paidAt || payment.createdAt,
            createdAt: payment.createdAt,
            paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
            email: payment.email,
            service: {
              id: payment.requestId,
              itemName: managedService?.itemName,
              category: managedService?.category,
            },
          });
        } else {
          receipts.push({
            id: payment._id,
            type: "match_report",
            amount: payment.amount,
            currency: payment.currency || "usd",
            planType: payment.planType,
            paidAt: payment.paidAt || payment.createdAt,
            createdAt: payment.createdAt,
            paymentMethod: payment.stripePaymentIntentId ? "stripe" : "credits",
            email: payment.email,
            request: {
              id: payment.requestId?._id || payment.requestId,
              name: payment.requestId?.name,
              category: payment.requestId?.category,
            },
          });
        }
      }
    }

    // Sort by date (newest first)
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
    console.error("Error fetching all transactions:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get dashboard stats
 */
export const getDashboardStats = async (req, res) => {
  try {
    const [
      totalUsers,
      activeSubscriptions,
      totalSuppliers,
      totalFeedback,
      newFeedback,
    ] = await Promise.all([
      User.countDocuments(),
      User.countDocuments({ subscriptionStatus: "active" }),
      Supplier.countDocuments({ isActive: true }),
      Feedback.countDocuments(),
      Feedback.countDocuments({ status: "new" }),
    ]);

    res.json({
      success: true,
      data: {
        totalUsers,
        activeSubscriptions,
        totalSuppliers,
        totalFeedback,
        newFeedback,
      },
    });
  } catch (error) {
    console.error("Error getting dashboard stats:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
