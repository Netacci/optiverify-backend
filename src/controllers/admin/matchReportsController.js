import MatchReport from "../../models/customer/MatchReport.js";
import BuyerRequest from "../../models/customer/BuyerRequest.js";
import Payment from "../../models/customer/Payment.js";
import CreditTransaction from "../../models/customer/CreditTransaction.js";
import mongoose from "mongoose";

/**
 * Get all match reports (Admin)
 */
export const getAllMatchReports = async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const limit = parseInt(req.query.limit) || 20;
    const skip = (page - 1) * limit;

    const { status, paymentStatus, email } = req.query;
    const query = {};

    if (status) query.status = status;
    if (email) {
      query.email = { $regex: email, $options: "i" };
    }

    // If paymentStatus filter is provided, we need to fetch all matching reports first
    // to calculate actual payment status from Payment records, then filter
    const shouldFilterByPayment = !!paymentStatus;
    
    // Fetch all reports matching other filters (or paginated if no paymentStatus filter)
    const [allMatchReports, baseTotal] = await Promise.all([
      shouldFilterByPayment
        ? MatchReport.find(query)
            .populate("requestId", "category description budget location email")
            .sort({ createdAt: -1 })
        : MatchReport.find(query)
            .populate("requestId", "category description budget location email")
            .sort({ createdAt: -1 })
            .skip(skip)
            .limit(limit),
      MatchReport.countDocuments(query),
    ]);

    // Get payment status for each report
    const reportsWithPayment = await Promise.all(
      allMatchReports.map(async (report) => {
        const payment = await Payment.findOne({
          requestId: report.requestId?._id,
          status: "succeeded",
        });

        // Check if credits were used for this request
        const creditTransaction = await CreditTransaction.findOne({
          requestId: report.requestId?._id,
          transactionType: "deducted",
          reason: { $in: ["match_generation", "unlock_request"] },
        });

        // Payment status: completed if payment exists OR credits were used
        const calculatedPaymentStatus =
          payment || creditTransaction
            ? "completed"
            : report.paymentStatus || "pending";

        return {
          ...report.toObject(),
          paymentStatus: calculatedPaymentStatus,
          paymentId: payment?._id || report.paymentId,
          paymentMethod: payment ? "payment" : creditTransaction ? "credit" : null,
          userEmail: report.email || report.requestId?.email,
        };
      })
    );

    // Filter by payment status after calculating it
    let filteredReports = reportsWithPayment;
    if (paymentStatus) {
      filteredReports = reportsWithPayment.filter(
        (report) => report.paymentStatus === paymentStatus
      );
    }

    // Apply pagination if paymentStatus filter was used
    const paginatedReports = shouldFilterByPayment
      ? filteredReports.slice(skip, skip + limit)
      : filteredReports;

    const finalTotal = shouldFilterByPayment ? filteredReports.length : baseTotal;

    res.json({
      success: true,
      data: {
        reports: paginatedReports,
        pagination: {
          page,
          limit,
          total: finalTotal,
          pages: Math.ceil(finalTotal / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting match reports:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get single match report details (Admin)
 */
export const getMatchReportDetails = async (req, res) => {
  try {
    const { id } = req.params;

    const matchReport = await MatchReport.findOne({ requestId: id })
      .populate("requestId")
      .populate("fullReport.suppliers.supplierId")
      .populate("editedBy", "email");

    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    // Get payment info
    const payment = await Payment.findOne({
      requestId: id,
      status: "succeeded",
    });

    // Check if credits were used for this request
    const creditTransaction = await CreditTransaction.findOne({
      requestId: id,
      transactionType: "deducted",
      reason: { $in: ["match_generation", "unlock_request"] },
    });

    // Payment status: completed if payment exists OR credits were used
    const paymentStatus =
      payment || creditTransaction
        ? "completed"
        : matchReport.paymentStatus || "pending";

    res.json({
      success: true,
      data: {
        ...matchReport.toObject(),
        paymentStatus,
        paymentId: payment?._id || matchReport.paymentId,
        paymentMethod: payment ? "payment" : creditTransaction ? "credit" : null,
        userEmail: matchReport.email || matchReport.requestId?.email,
        paymentDetails: payment
          ? {
              planType: payment.planType,
              amount: payment.amount,
              paidAt: payment.paidAt,
            }
          : creditTransaction
          ? {
              method: "credit",
              creditsUsed: creditTransaction.creditsUsed,
              usedAt: creditTransaction.createdAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error getting match report details:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update match report (Admin can improve AI results)
 */
export const updateMatchReport = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      preview,
      fullReport,
      adminNotes,
    } = req.body;

    console.log("Update request received:", {
      id,
      suppliersCount: fullReport?.suppliers?.length || 0,
      hasPreview: !!preview,
      hasFullReport: !!fullReport,
    });

    const matchReport = await MatchReport.findOne({ requestId: id });

    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    // Update preview if provided
    if (preview) {
      matchReport.preview = {
        ...(matchReport.preview || {}),
        ...preview,
      };
    }

    // Update full report suppliers if provided
    if (fullReport?.suppliers) {
      console.log("Processing suppliers array, count:", fullReport.suppliers.length);
      
      // Recalculate rankings based on order and ensure supplierId is ObjectId
      const suppliersWithRankings = fullReport.suppliers.map((supplier, index) => {
        // Handle supplierId - it might be a string, ObjectId, or an object with _id
        let supplierId = supplier.supplierId;
        if (typeof supplierId === 'object' && supplierId !== null && supplierId._id) {
          supplierId = supplierId._id;
        }
        if (typeof supplierId === 'string' && mongoose.Types.ObjectId.isValid(supplierId)) {
          supplierId = new mongoose.Types.ObjectId(supplierId);
        } else if (!(supplierId instanceof mongoose.Types.ObjectId) && mongoose.Types.ObjectId.isValid(supplierId)) {
          supplierId = new mongoose.Types.ObjectId(supplierId);
        }
        
        const supplierData = {
          supplierId: supplierId,
          matchScore: supplier.matchScore || 0,
          ranking: index + 1,
          whyTheyMatch: supplier.whyTheyMatch || "",
          aiExplanation: supplier.aiExplanation || "",
          strengths: Array.isArray(supplier.strengths) ? supplier.strengths : [],
          concerns: Array.isArray(supplier.concerns) ? supplier.concerns : [],
        };
        
        console.log(`Supplier ${index + 1}:`, {
          supplierId: supplierData.supplierId.toString(),
          matchScore: supplierData.matchScore,
          hasStrengths: supplierData.strengths.length,
          hasConcerns: supplierData.concerns.length,
        });
        
        return supplierData;
      });
      
      console.log("Processed suppliers count:", suppliersWithRankings.length);

      // Initialize fullReport if it doesn't exist
      if (!matchReport.fullReport) {
        matchReport.fullReport = {};
      }

      // Directly set the suppliers array - this ensures Mongoose detects the change
      matchReport.fullReport.suppliers = suppliersWithRankings;
      matchReport.fullReport.manuallyEdited = true;
      matchReport.fullReport.editedAt = new Date();
      matchReport.fullReport.editedBy = req.admin._id;
      
      // Preserve generatedAt if it exists
      if (matchReport.fullReport.generatedAt) {
        // Keep existing generatedAt
      } else if (!matchReport.fullReport.generatedAt) {
        // Set generatedAt if it doesn't exist (shouldn't happen, but just in case)
        matchReport.fullReport.generatedAt = new Date();
      }

      // Mark the nested path as modified so Mongoose saves it
      matchReport.markModified("fullReport");
      matchReport.markModified("fullReport.suppliers");

      // Update preview supplier to be the first one if changed
      if (suppliersWithRankings.length > 0) {
        const firstSupplierId = suppliersWithRankings[0].supplierId;
        matchReport.preview.previewSupplier = mongoose.Types.ObjectId.isValid(firstSupplierId)
          ? new mongoose.Types.ObjectId(firstSupplierId)
          : firstSupplierId;
        matchReport.preview.matchedCount = suppliersWithRankings.length;
        // Recalculate average match score
        const avgScore = Math.round(
          suppliersWithRankings.reduce((sum, s) => sum + (s.matchScore || 0), 0) /
            suppliersWithRankings.length
        );
        matchReport.preview.matchScore = avgScore;
        matchReport.markModified("preview");
      }
    }

    // Store admin notes
    if (adminNotes !== undefined) {
      matchReport.adminNotes = adminNotes;
    }

    // Mark as manually edited
    matchReport.manuallyEdited = true;
    matchReport.editedAt = new Date();
    matchReport.editedBy = req.admin._id;

    // Log what we're about to save for debugging
    console.log("Saving match report with suppliers count:", matchReport.fullReport?.suppliers?.length || 0);
    
    // Save the document
    await matchReport.save();
    
    // Verify what was saved
    const savedReport = await MatchReport.findOne({ requestId: id });
    console.log("After save, suppliers count in DB:", savedReport?.fullReport?.suppliers?.length || 0);

    // Re-fetch the updated report to ensure we have the latest data
    // Use the same approach as getMatchReportDetails for consistency
    const updatedReport = await MatchReport.findOne({ requestId: id })
      .populate("requestId")
      .populate("fullReport.suppliers.supplierId")
      .populate("editedBy", "email");

    if (!updatedReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found after update",
      });
    }

    // Get payment info for the response
    const payment = await Payment.findOne({
      requestId: id,
      status: "succeeded",
    });

    // Check if credits were used for this request
    const creditTransaction = await CreditTransaction.findOne({
      requestId: id,
      transactionType: "deducted",
      reason: { $in: ["match_generation", "unlock_request"] },
    });

    // Use toObject() to convert Mongoose document to plain object
    // This ensures all populated fields are properly serialized
    const reportObject = updatedReport.toObject();

    // Payment status: completed if payment exists OR credits were used
    const paymentStatus =
      payment || creditTransaction
        ? "completed"
        : reportObject.paymentStatus || "pending";

    res.json({
      success: true,
      message: "Match report updated successfully",
      data: {
        ...reportObject,
        paymentStatus,
        paymentId: payment?._id || reportObject.paymentId,
        paymentMethod: payment ? "payment" : creditTransaction ? "credit" : null,
        userEmail: reportObject.email || reportObject.requestId?.email,
        paymentDetails: payment
          ? {
              planType: payment.planType,
              amount: payment.amount,
              paidAt: payment.paidAt,
            }
          : creditTransaction
          ? {
              method: "credit",
              creditsUsed: creditTransaction.creditsUsed,
              usedAt: creditTransaction.createdAt,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error updating match report:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

