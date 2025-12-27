import BuyerRequest from "../../models/customer/BuyerRequest.js";
import Supplier from "../../models/admin/Supplier.js";
import MatchReport from "../../models/customer/MatchReport.js";
import {
  calculateAIMatchScore,
  generateAIExplanation,
  generateRequestSummary,
  calculateRuleBasedScore,
  generateTemplateExplanation,
} from "../../services/aiService.js";
import { verifyToken } from "../../services/tokenService.js";

// Process request and match suppliers
export const processMatching = async (req, res) => {
  try {
    const { id } = req.params;

    // Get the buyer request
    const buyerRequest = await BuyerRequest.findById(id);
    if (!buyerRequest) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Check if match report already exists
    let matchReport = await MatchReport.findOne({ requestId: id });

    // Allow regeneration if status is "pending" or "unlocked", but not if already "completed"
    if (matchReport && matchReport.status === "completed") {
      return res.json({
        success: true,
        message: "Match report already generated",
        data: {
          requestId: id,
          matchReportId: matchReport._id,
          preview: matchReport.preview,
        },
      });
    }

    // Check if user has active subscription plan (if authenticated)
    // If not authenticated or no active subscription, redirect to payment page
    let hasActivePlan = false;
    let user = null;

    if (req.user) {
      const User = (await import("../../models/common/User.js")).default;
      user = await User.findById(req.user._id);

      if (user) {
        hasActivePlan =
          user.subscriptionStatus === "active" &&
          (!user.subscriptionExpiresAt ||
            new Date(user.subscriptionExpiresAt) > new Date());
      }
    }

    // If user doesn't have active subscription, generate fallback (rule-based) match for preview
    // This allows public users to see a preview before payment
    if (!hasActivePlan) {
      // Generate fallback match using rule-based scoring
      const allSuppliers = await Supplier.find({ isActive: true });
      if (allSuppliers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No suppliers available in database",
        });
      }

      // Calculate rule-based match scores
      const suppliersWithScores = allSuppliers.map((supplier) => {
        const matchResult = calculateRuleBasedScore(buyerRequest, supplier);
        return {
          supplier,
          matchScore: matchResult.score,
          factors: matchResult.factors,
          whyMatch: matchResult.whyMatch || matchResult.factors.join(", "),
        };
      });

      // Sort by match score (highest first)
      suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);

      // Filter suppliers with score > 0 and get top 5
      const qualifiedSuppliers = suppliersWithScores.filter(
        (item) => item.matchScore > 0
      );
      const topSuppliers = qualifiedSuppliers.slice(0, 5);

      if (topSuppliers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No matching suppliers found",
        });
      }

      // Select preview supplier (highest score)
      const previewSupplier = topSuppliers[0].supplier;
      const averageScore = Math.round(
        topSuppliers.reduce((sum, item) => sum + item.matchScore, 0) /
          topSuppliers.length
      );

      // Generate simple summary
      const requestSummary = buyerRequest.description
        ? buyerRequest.description.substring(0, 200)
        : `Request for ${buyerRequest.name} in ${buyerRequest.category} category`;

      // Create or update match report with fallback data (status: pending)
      if (!matchReport) {
        matchReport = new MatchReport({
          requestId: id,
          email: buyerRequest.email,
          status: "pending",
          preview: {
            summary: requestSummary,
            category: buyerRequest.category,
            matchedCount: topSuppliers.length,
            matchScore: averageScore,
            previewSupplier: previewSupplier._id,
          },
          fullReport: {
            suppliers: topSuppliers.map((item, index) => ({
              supplierId: item.supplier._id,
              matchScore: item.matchScore,
              ranking: index + 1,
              whyTheyMatch: item.whyMatch,
              aiExplanation: generateTemplateExplanation(
                buyerRequest,
                item.supplier,
                item.matchScore,
                item.factors || []
              ),
              strengths: [],
              concerns: [],
            })),
            generatedAt: new Date(),
          },
        });
      } else {
        matchReport.status = "pending";
        matchReport.preview = {
          summary: requestSummary,
          category: buyerRequest.category,
          matchedCount: topSuppliers.length,
          matchScore: averageScore,
          previewSupplier: previewSupplier._id,
        };
        matchReport.fullReport = {
          suppliers: topSuppliers.map((item, index) => ({
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: item.whyMatch,
            aiExplanation: generateTemplateExplanation(
              buyerRequest,
              item.supplier,
              item.matchScore,
              item.factors || []
            ),
            strengths: [],
            concerns: [],
          })),
          generatedAt: new Date(),
        };
      }

      await matchReport.save();

      // Return preview data (without supplier names) - this is what the frontend expects
      return res.json({
        success: true,
        message: "Fallback match generated successfully",
        data: {
          requestId: id,
          matchReportId: matchReport._id,
          isUnlocked: false,
          preview: {
            summary: matchReport.preview.summary,
            category: matchReport.preview.category,
            matchedCount: matchReport.preview.matchedCount,
            matchScore: matchReport.preview.matchScore,
            message: "Preview ready! Unlock to see full details.",
          },
        },
      });
    }

    // Find matching suppliers
    const allSuppliers = await Supplier.find({ isActive: true });

    if (allSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No suppliers available in database",
      });
    }

    // User has active subscription, use AI matching
    const isAuthenticated = !!req.user;

    // Calculate match scores for all suppliers
    // Use AI matching for authenticated users with active subscription
    console.log(
      `🔍 Calculating match scores for ${allSuppliers.length} suppliers... (AI matching)`
    );
    const suppliersWithScores = await Promise.all(
      allSuppliers.map(async (supplier) => {
        // Use AI matching (user has active subscription)
        const matchResult = await calculateAIMatchScore(buyerRequest, supplier);
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
    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);

    // Filter suppliers with score > 0 and get top 5
    const qualifiedSuppliers = suppliersWithScores.filter(
      (item) => item.matchScore > 0
    );
    const topSuppliers = qualifiedSuppliers.slice(0, 5);

    if (topSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching suppliers found",
      });
    }

    // Select preview supplier (highest score)
    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, item) => sum + item.matchScore, 0) /
        topSuppliers.length
    );

    // Generate summary of the request using AI
    console.log(`📝 Generating AI request summary...`);
    const requestSummary = await generateRequestSummary(buyerRequest);

    // Generate AI explanations for each supplier
    console.log(`🤖 Generating AI explanations for matched suppliers...`);
    const suppliersWithExplanations = await Promise.all(
      topSuppliers.map(async (item, index) => {
        // Use AI explanation (user has active subscription)
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
          whyTheyMatch: item.whyMatch || item.factors.join(", "),
          aiExplanation: explanation,
          strengths: item.strengths,
          concerns: item.concerns,
        };
      })
    );

    // If user has credits, deduct one (user has active subscription)
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
        requestId: id,
        matchReportId: matchReport?._id || null,
        email: user.email,
        creditsUsed: 1,
        creditsBefore,
        creditsAfter: user.matchCredits,
        transactionType: "deducted",
        reason: "match_generation",
        notes: "Credit used for AI match generation",
      });

      console.log(
        `[processMatching] Deducted 1 credit from user ${user._id}. Remaining: ${user.matchCredits}`
      );
    }

    // Determine status:
    // - Public users or authenticated without active plan: "pending"
    // - Authenticated users with active plan: "completed" (uses AI directly)
    const reportStatus = hasActivePlan ? "completed" : "pending";

    // Create or update match report
    if (!matchReport) {
      matchReport = new MatchReport({
        requestId: id,
        email: buyerRequest.email,
        status: reportStatus,
        preview: {
          summary: requestSummary,
          category: buyerRequest.category,
          matchedCount: topSuppliers.length,
          matchScore: averageScore,
          previewSupplier: previewSupplier._id,
        },
        fullReport: {
          suppliers: suppliersWithExplanations,
          generatedAt: new Date(),
        },
      });
    } else {
      matchReport.status = reportStatus;
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
    }

    await matchReport.save();

    // Update buyer request status
    buyerRequest.status = "processing";
    await buyerRequest.save();

    console.log(
      `✅ Match report generated successfully with ${topSuppliers.length} suppliers`
    );

    // Return preview data (without supplier names)
    res.json({
      success: true,
      message: "Match report generated successfully",
      data: {
        requestId: id,
        matchReportId: matchReport._id,
        isUnlocked: matchReport.status === "unlocked", // Explicitly return unlock status
        preview: {
          summary: matchReport.preview.summary,
          category: matchReport.preview.category,
          matchedCount: matchReport.preview.matchedCount,
          matchScore: matchReport.preview.matchScore,
          message: "Your match is ready!",
        },
      },
    });
  } catch (error) {
    console.error("Error processing matching:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get preview (free)
export const getPreview = async (req, res) => {
  try {
    const { id } = req.params;

    let matchReport = await MatchReport.findOne({ requestId: id }).populate(
      "preview.previewSupplier"
    );

    // Get buyer request (needed for both existing and new match reports)
    const buyerRequest = await BuyerRequest.findById(id);
    if (!buyerRequest) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // If no match report exists, generate a fallback (rule-based) match for preview
    if (!matchReport) {
      // Generate fallback match using rule-based scoring
      const allSuppliers = await Supplier.find({ isActive: true });
      if (allSuppliers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No suppliers available",
        });
      }

      // Calculate rule-based match scores
      const suppliersWithScores = allSuppliers.map((supplier) => {
        const matchResult = calculateRuleBasedScore(buyerRequest, supplier);
        return {
          supplier,
          matchScore: matchResult.score,
          factors: matchResult.factors,
          whyMatch: matchResult.whyMatch || matchResult.factors.join(", "),
        };
      });

      // Sort by match score (highest first)
      suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);

      // Filter suppliers with score > 0 and get top 5
      const qualifiedSuppliers = suppliersWithScores.filter(
        (item) => item.matchScore > 0
      );
      const topSuppliers = qualifiedSuppliers.slice(0, 5);

      if (topSuppliers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No matching suppliers found",
        });
      }

      // Select preview supplier (highest score)
      const previewSupplier = topSuppliers[0].supplier;
      const averageScore = Math.round(
        topSuppliers.reduce((sum, item) => sum + item.matchScore, 0) /
          topSuppliers.length
      );

      // Generate simple summary
      const requestSummary = buyerRequest.description
        ? buyerRequest.description.substring(0, 200)
        : `Request for ${buyerRequest.name} in ${buyerRequest.category} category`;

      // Create match report with fallback data (status: pending)
      matchReport = new MatchReport({
        requestId: id,
        email: buyerRequest.email,
        status: "pending",
        preview: {
          summary: requestSummary,
          category: buyerRequest.category,
          matchedCount: topSuppliers.length,
          matchScore: averageScore,
          previewSupplier: previewSupplier._id,
        },
        fullReport: {
          suppliers: topSuppliers.map((item, index) => ({
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: item.whyMatch,
            aiExplanation: generateTemplateExplanation(
              buyerRequest,
              item.supplier,
              item.matchScore,
              item.factors || []
            ),
            strengths: [],
            concerns: [],
          })),
          generatedAt: new Date(),
        },
      });

      await matchReport.save();
      await matchReport.populate("preview.previewSupplier");
    }

    // Get match report with suppliers populated to calculate fits
    const matchReportWithSuppliers = await MatchReport.findOne({
      requestId: id,
    }).populate("fullReport.suppliers.supplierId");

    // Calculate category fit and capability fit
    let categoryFit = "N/A";
    let capabilityFit = "N/A";

    if (matchReportWithSuppliers?.fullReport?.suppliers?.[0] && buyerRequest) {
      const firstSupplier = matchReportWithSuppliers.fullReport.suppliers[0];
      const supplier = firstSupplier.supplierId;

      // Category fit
      if (
        supplier?.category?.toLowerCase() ===
        buyerRequest.category?.toLowerCase()
      ) {
        categoryFit = "Perfect Match";
      } else {
        categoryFit = "Partial Match";
      }

      // Capability fit (check if supplier capabilities match request requirements/description)
      const requestText = `${buyerRequest.description} ${
        buyerRequest.requirements || ""
      }`.toLowerCase();
      const supplierCapabilities = supplier?.capabilities || [];
      const matchingCapabilities = supplierCapabilities.filter((cap) =>
        requestText.includes(cap.toLowerCase())
      );

      if (matchingCapabilities.length > 0) {
        capabilityFit = `${matchingCapabilities.length} Capabilities Match`;
      } else if (supplierCapabilities.length > 0) {
        capabilityFit = "Capabilities Available";
      } else {
        capabilityFit = "Limited";
      }
    }

    // Return only preview data (no supplier names in full report)
    res.json({
      success: true,
      data: {
        preview: matchReport.preview,
        // Include buyer request details
        request: buyerRequest
          ? {
              name: buyerRequest.name,
              category: buyerRequest.category,
              unitPrice: buyerRequest.unitPrice,
              totalAmount: buyerRequest.totalAmount,
              quantity: buyerRequest.quantity,
              description: buyerRequest.description,
              timeline: buyerRequest.timeline,
              location: buyerRequest.location,
              requirements: buyerRequest.requirements,
            }
          : null,
        // Include preview supplier info (this is the free preview)
        previewSupplier: matchReport.preview.previewSupplier
          ? {
              name: matchReport.preview.previewSupplier.name,
              location: matchReport.preview.previewSupplier.location,
              description: matchReport.preview.previewSupplier.description,
              certifications:
                matchReport.preview.previewSupplier.certifications,
              leadTime: matchReport.preview.previewSupplier.leadTime,
              categoryFit,
              capabilityFit,
            }
          : null,
      },
    });
  } catch (error) {
    console.error("Error fetching preview:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Generate AI match for pending reports (for paid users who submitted via frontend)
export const generateAIMatch = async (req, res) => {
  try {
    const { id } = req.params;

    // Must be authenticated to generate AI match
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required to generate AI match",
      });
    }

    // Get the buyer request
    const buyerRequest = await BuyerRequest.findById(id);
    if (!buyerRequest) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Check if match report exists and is unlocked (after payment)
    let matchReport = await MatchReport.findOne({ requestId: id });
    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    if (matchReport.status !== "unlocked") {
      return res.status(400).json({
        success: false,
        message: `Match report is already ${matchReport.status}. AI matching can only be triggered for unlocked reports (after payment).`,
      });
    }

    // Verify user has paid for this report (check payment)
    const Payment = (await import("../../models/customer/Payment.js")).default;
    const payment = await Payment.findOne({
      requestId: id,
      status: "succeeded",
    });

    if (!payment) {
      return res.status(403).json({
        success: false,
        message: "Payment required to generate AI match",
      });
    }

    // Find matching suppliers
    const allSuppliers = await Supplier.find({ isActive: true });

    if (allSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No suppliers available in database",
      });
    }

    // Use AI matching (user is authenticated and has paid)
    console.log(
      `🔍 Generating AI match for ${allSuppliers.length} suppliers...`
    );
    const suppliersWithScores = await Promise.all(
      allSuppliers.map(async (supplier) => {
        const matchResult = await calculateAIMatchScore(buyerRequest, supplier);
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
    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);

    // Filter suppliers with score > 0 and get top 5
    const qualifiedSuppliers = suppliersWithScores.filter(
      (item) => item.matchScore > 0
    );
    const topSuppliers = qualifiedSuppliers.slice(0, 5);

    if (topSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No matching suppliers found",
      });
    }

    // Select preview supplier (highest score)
    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, item) => sum + item.matchScore, 0) /
        topSuppliers.length
    );

    // Generate AI summary
    console.log(`📝 Generating AI request summary...`);
    const requestSummary = await generateRequestSummary(buyerRequest);

    // Generate AI explanations for each supplier
    console.log(`🤖 Generating AI explanations for matched suppliers...`);
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
          whyTheyMatch: item.whyMatch || item.factors.join(", "),
          aiExplanation: explanation,
          strengths: item.strengths,
          concerns: item.concerns,
        };
      })
    );

    // Update match report with AI-generated results
    // Set status to "completed" after AI matching (whether AI succeeds or fallback is used)
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
      `✅ AI match report generated successfully with ${topSuppliers.length} suppliers`
    );

    res.json({
      success: true,
      message: "AI match generated successfully",
      data: {
        requestId: id,
        matchReportId: matchReport._id,
        isUnlocked: true,
        preview: {
          summary: matchReport.preview.summary,
          category: matchReport.preview.category,
          matchedCount: matchReport.preview.matchedCount,
          matchScore: matchReport.preview.matchScore,
        },
      },
    });
  } catch (error) {
    console.error("Error generating AI match:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get full report (paid/unlocked)
export const getFullReport = async (req, res) => {
  try {
    const { id } = req.params;
    const { token, email } = req.query;

    const matchReport = await MatchReport.findOne({ requestId: id }).populate(
      "fullReport.suppliers.supplierId"
    );

    if (!matchReport) {
      return res.status(404).json({
        success: false,
        message: "Match report not found",
      });
    }

    // Check if report is unlocked or pending (pending allows user to see button to generate)
    if (
      matchReport.status !== "unlocked" &&
      matchReport.status !== "paid" &&
      matchReport.status !== "pending"
    ) {
      return res.status(403).json({
        success: false,
        message: "Full report is locked. Please complete payment to unlock.",
      });
    }

    // Verify token if provided (for email-based access)
    if (token && email) {
      const verification = verifyToken(token, email, id, "payment");
      if (!verification.valid) {
        return res.status(403).json({
          success: false,
          message:
            verification.error ||
            "Invalid or expired access link. Please check your email for a valid link.",
        });
      }
    } else {
      // If no token provided, still allow access (for direct URL access during development/testing)
      // In production, you might want to require token for all access
      if (process.env.NODE_ENV === "production") {
        return res.status(403).json({
          success: false,
          message:
            "Secure access link required. Please use the link from your email.",
        });
      }
    }

    // Return full report with all supplier details
    const fullSuppliers = matchReport.fullReport.suppliers.map((item) => {
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
        requestId: matchReport.requestId,
        preview: matchReport.preview,
        suppliers: fullSuppliers,
        generatedAt: matchReport.fullReport.generatedAt,
      },
    });
  } catch (error) {
    console.error("Error fetching full report:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
