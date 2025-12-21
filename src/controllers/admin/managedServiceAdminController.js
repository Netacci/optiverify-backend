import ManagedService from "../../models/customer/ManagedService.js";
import { enrichManagedServices, enrichManagedService } from "../../utils/managedServiceUtils.js";
// import { sendEmail } from "../../services/emailService.js"; // Will integrate later

/**
 * Get all managed service requests (Admin)
 */
export const getAllRequests = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { status, stage } = req.query;
    const query = {};

    if (status) query.status = status;
    if (stage) query.stage = stage;

    const [requests, total] = await Promise.all([
      ManagedService.find(query)
        .populate("userId", "email") // Get user details if needed
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit),
      ManagedService.countDocuments(query),
    ]);

    // Enrich requests with days left calculation
    const enrichedRequests = await enrichManagedServices(requests);

    res.json({
      success: true,
      data: {
        requests: enrichedRequests,
        pagination: {
          page,
          limit,
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting all managed requests:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get Single Request Details (Admin)
 */
export const getRequestDetails = async (req, res) => {
  try {
    const { id } = req.params;
    const request = await ManagedService.findById(id).populate("userId", "email");

    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
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
 * Update Request Stage (Move workflow forward)
 */
export const updateStage = async (req, res) => {
  try {
    const { id } = req.params;
    const { stage, adminNotes } = req.body;

    const request = await ManagedService.findById(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Update fields
    if (stage) request.stage = stage;
    if (adminNotes) request.adminNotes = adminNotes;

    // Auto-update status based on stage
    if (stage === "report_ready") {
      request.status = "action_required"; // Needs customer to pay/view
    } else if (stage === "final_report") {
      request.status = "completed";
    } else {
      request.status = "in_progress";
    }

    await request.save();

    // TODO: Trigger email notification to user about stage change via Resend

    res.json({
      success: true,
      message: "Stage updated successfully",
      data: request,
    });
  } catch (error) {
    console.error("Error updating stage:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update Negotiated Pricing & Suppliers (Admin Step)
 */
export const updateQuotes = async (req, res) => {
  try {
    const { id } = req.params;
    const { originalPrice, negotiatedPrice, suppliers } = req.body;

    const request = await ManagedService.findById(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Update financials
    if (originalPrice !== undefined) request.originalPrice = originalPrice;
    if (negotiatedPrice !== undefined) {
      request.negotiatedPrice = negotiatedPrice;

      // Calculate Savings Fee
      if (
        request.originalPrice &&
        request.negotiatedPrice < request.originalPrice
      ) {
        const savings = request.originalPrice - request.negotiatedPrice;
        request.savingsAmount = savings;
        // Use the percentage locked at creation time
        request.savingsFeeAmount =
          savings * (request.savingsFeePercentage / 100);
        request.savingsFeeStatus = "pending";
      } else {
        request.savingsAmount = 0;
        request.savingsFeeAmount = 0;
        request.savingsFeeStatus = "not_applicable";
      }
    }

    // Update suppliers list
    if (suppliers) {
      request.suppliers = suppliers;
    }

    await request.save();

    res.json({
      success: true,
      message: "Quotes and financials updated",
      data: request,
    });
  } catch (error) {
    console.error("Error updating quotes:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Save Final Report (What customer sees when report is ready)
 */
export const saveReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { finalReport } = req.body;

    const request = await ManagedService.findById(id);
    if (!request) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Calculate savings fee based on recommended supplier
    if (finalReport && finalReport.supplierDetails) {
      const recommendedSupplier = finalReport.supplierDetails.find(
        (s) => s.isRecommended
      );

      if (recommendedSupplier) {
        const quoteAmount = recommendedSupplier.quoteAmount || 0;
        const negotiatedAmount = recommendedSupplier.negotiatedAmount || 0;

        // Calculate savings: Quote Amount - Negotiated Amount
        if (negotiatedAmount > 0 && quoteAmount > negotiatedAmount) {
          const savings = quoteAmount - negotiatedAmount;
          request.savingsAmount = savings;
          // Use the percentage locked at creation time
          request.savingsFeeAmount =
            savings * (request.savingsFeePercentage / 100);
          request.savingsFeeStatus = "pending";
          // Update negotiated price for backward compatibility
          request.negotiatedPrice = negotiatedAmount;
        } else {
          // No savings if negotiated >= quote or no negotiation
          request.savingsAmount = 0;
          request.savingsFeeAmount = 0;
          request.savingsFeeStatus = "not_applicable";
          request.negotiatedPrice = negotiatedAmount || quoteAmount;
        }
      }
    }

    // Update final report
    if (finalReport) {
      request.finalReport = {
        ...finalReport,
        reportGeneratedAt: new Date(),
        reportGeneratedBy: req.admin._id,
      };
    }

    await request.save();

    res.json({
      success: true,
      message: "Report saved successfully",
      data: request,
    });
  } catch (error) {
    console.error("Error saving report:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
