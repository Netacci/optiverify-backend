import BuyerRequest from "../../models/customer/BuyerRequest.js";
import User from "../../models/common/User.js";

// Create a new buyer request
export const createRequest = async (req, res) => {
  try {
    // req.user is set by optionalAuth middleware if token exists

    const {
      name,
      category,
      unitPrice,
      quantity,
      description,
      timeline,
      location,
      requirements,
      email,
      // Legacy support for budget field
      budget,
    } = req.body;

    // Use authenticated user's email if available, otherwise use body email
    const userEmail = req.user?.email || email;

    // Validate required fields
    if (!name || !category || !unitPrice || !userEmail) {
      return res.status(400).json({
        success: false,
        message: "Name, category, unit price, and email are required",
        missing: {
          name: !name,
          category: !category,
          unitPrice: !unitPrice,
          email: !userEmail,
        },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Check if user exists with this email (only for public submissions, not authenticated users)
    if (!req.user) {
      const existingUser = await User.findOne({ email: userEmail.trim().toLowerCase() });
      
      // If user exists, they should submit from their dashboard, not the public form
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "An account with this email already exists. Please log in to your dashboard to submit a request.",
          code: "USER_EXISTS",
          redirectUrl: `${process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"}/login`,
        });
      }
    }

    // Parse unit price (remove $ if present, handle commas)
    const unitPriceNum = parseFloat(String(unitPrice).replace(/[$,]/g, ""));
    if (isNaN(unitPriceNum) || unitPriceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Unit price must be a valid positive number",
      });
    }

    // Parse quantity and calculate total amount
    let totalAmount = unitPriceNum;
    if (quantity) {
      // Extract number from quantity string (e.g., "1000 units" -> 1000)
      const quantityMatch = String(quantity).match(/(\d+(?:[.,]\d+)?)/);
      if (quantityMatch) {
        const quantityNum = parseFloat(quantityMatch[1].replace(/,/g, ""));
        if (!isNaN(quantityNum) && quantityNum > 0) {
          totalAmount = unitPriceNum * quantityNum;
        }
      }
    }

    // Create new buyer request
    const buyerRequest = new BuyerRequest({
      name,
      category,
      unitPrice: unitPriceNum,
      totalAmount,
      quantity,
      description,
      timeline,
      location,
      requirements,
      email: userEmail.trim(),
      status: "pending",
      // Keep budget for backward compatibility (deprecated)
      budget: budget || `$${totalAmount.toLocaleString()}`,
    });

    await buyerRequest.save();

    res.status(201).json({
      success: true,
      message: "Request submitted successfully",
      data: {
        id: buyerRequest._id,
        category: buyerRequest.category,
        status: buyerRequest.status,
        createdAt: buyerRequest.createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating buyer request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get a specific buyer request by ID
export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    const buyerRequest = await BuyerRequest.findById(id);

    if (!buyerRequest) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    res.json({
      success: true,
      data: buyerRequest,
    });
  } catch (error) {
    console.error("Error fetching buyer request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get all buyer requests
export const getAllRequests = async (req, res) => {
  try {
    const requests = await BuyerRequest.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("Error fetching buyer requests:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

