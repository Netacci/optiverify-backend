import BuyerRequest from "../../models/customer/BuyerRequest.js";
import Supplier from "../../models/admin/Supplier.js";
import MatchReport from "../../models/customer/MatchReport.js";
import {
  passesHardFilter,
  calculatePreviewScore,
  calculateHybridScore,
  generateWhyTheyMatch,
  generateRequestSummary,
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

    // Check if user has active subscription plan and credits (if authenticated)
    // Hybrid path runs only when: active plan AND at least one credit
    let hasActivePlan = false;
    let hasCreditsForHybrid = false;
    let user = null;

    if (req.user) {
      const User = (await import("../../models/common/User.js")).default;
      user = await User.findById(req.user._id);

      if (user) {
        hasActivePlan =
          user.subscriptionStatus === "active" &&
          (!user.subscriptionExpiresAt ||
            new Date(user.subscriptionExpiresAt) > new Date());
        hasCreditsForHybrid = !!(user.matchCredits > 0);
      }
    }

    // Load all active suppliers and apply hard filter (category + subCategory)
    const allSuppliers = await Supplier.find({ isActive: true });
    if (allSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No suppliers available in database",
      });
    }

    const reqSubCategory = buyerRequest.subCategory ?? buyerRequest.subcategory;
    if (process.env.NODE_ENV === "development") {
      console.log(`\n[HARD FILTER] Request category: "${buyerRequest.category}"${reqSubCategory ? ` | subCategory: "${reqSubCategory}"` : ""}`);
      console.log(`[HARD FILTER] Checking ${allSuppliers.length} active suppliers...`);
    }
    const filteredSuppliers = allSuppliers.filter((supplier) =>
      passesHardFilter(buyerRequest, supplier)
    );
    if (process.env.NODE_ENV === "development") {
      console.log(`[HARD FILTER] ${filteredSuppliers.length} passed, ${allSuppliers.length - filteredSuppliers.length} excluded\n`);
    }

    if (filteredSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "No suppliers found matching your category" +
          (reqSubCategory ? " and subcategory" : "") +
          ". Try broadening your selection.",
      });
    }

    // --- PATH A: No active plan or no credits — rule-based preview only, no AI ---
    if (!hasActivePlan || !hasCreditsForHybrid) {
      if (process.env.NODE_ENV === "development") {
        console.log(`\n${"─".repeat(60)}`);
        console.log(`[PREVIEW SCORING] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${reqSubCategory ? ` > ${reqSubCategory}` : ""}`);
        console.log(`Scoring ${filteredSuppliers.length} category-matched suppliers (rule-based, no AI)`);
        console.log(`─────────────────────────────────────────────────────────`);
      }

      const suppliersWithScores = filteredSuppliers.map((supplier) => {
        const result = calculatePreviewScore(buyerRequest, supplier);
        return { supplier, matchScore: result.score, factors: result.factors };
      });

      suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
      // Take top 5 regardless of score — passing the hard filter is the quality gate
      const topSuppliers = suppliersWithScores.slice(0, 5);

      const previewSupplier = topSuppliers[0].supplier;
      const averageScore = Math.round(
        topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
      );

      if (process.env.NODE_ENV === "development") {
        console.log(`─────────────────────────────────────────────────────────`);
        console.log(`[PREVIEW RESULTS] Top ${topSuppliers.length} of ${filteredSuppliers.length} category-matched suppliers:`);
        topSuppliers.forEach((s, i) =>
          console.log(`  #${i + 1} ${s.supplier.name} — ${s.matchScore}/100`)
        );
        console.log(`  Total in category: ${filteredSuppliers.length} | Average score: ${averageScore}/100`);
        console.log(`${"─".repeat(60)}\n`);
      }

      const requestSummary = buyerRequest.description
        ? buyerRequest.description.substring(0, 200)
        : `Request for ${buyerRequest.name} in the ${buyerRequest.category} category.`;

      const reportData = {
        status: "pending",
        preview: {
          summary: requestSummary,
          category: buyerRequest.category,
          matchedCount: filteredSuppliers.length,
          matchScore: averageScore,
          previewSupplier: previewSupplier._id,
        },
        fullReport: {
          suppliers: topSuppliers.map((item, index) => ({
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: item.factors.join(", "),
            aiExplanation: generateTemplateExplanation(
              buyerRequest,
              item.supplier,
              item.matchScore,
              item.factors
            ),
            strengths: [],
            concerns: [],
          })),
          generatedAt: new Date(),
        },
      };

      if (!matchReport) {
        matchReport = new MatchReport({ requestId: id, email: buyerRequest.email, ...reportData });
      } else {
        Object.assign(matchReport, reportData);
      }
      await matchReport.save();

      return res.json({
        success: true,
        message: "Preview match generated. Unlock to see full supplier details.",
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

    // --- PATH B: Active subscription with credits — hybrid scoring with Groq AI ---
    // Deduct 1 credit and log transaction BEFORE any Groq calls
    if (user && user.matchCredits > 0) {
      const creditsBefore = user.matchCredits;
      user.matchCredits -= 1;
      await user.save();

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
        notes: "Credit used for hybrid AI match generation",
      });

      if (process.env.NODE_ENV === "development") {
        console.log(
          `[processMatching] Deducted 1 credit from user ${user._id}. Remaining: ${user.matchCredits}`
        );
      }
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`[HYBRID SCORING] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${reqSubCategory ? ` > ${reqSubCategory}` : ""}`);
      console.log(`Scoring ${filteredSuppliers.length} category-matched suppliers (OpenAI AI + rule-based)`);
      console.log(`─────────────────────────────────────────────────────────`);
    }

    const suppliersWithScores = await Promise.all(
      filteredSuppliers.map(async (supplier) => {
        const result = await calculateHybridScore(buyerRequest, supplier);
        return { supplier, matchScore: result.score, factors: result.factors };
      })
    );

    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
    const topSuppliers = suppliersWithScores.slice(0, 5);

    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
    );

    if (process.env.NODE_ENV === "development") {
      console.log(`─────────────────────────────────────────────────────────`);
      console.log(`[HYBRID RESULTS] Top ${topSuppliers.length} of ${filteredSuppliers.length} category-matched suppliers:`);
      topSuppliers.forEach((s, i) =>
        console.log(`  #${i + 1} ${s.supplier.name} — ${s.matchScore}/100`)
      );
      console.log(`  Total in category: ${filteredSuppliers.length} | Average score: ${averageScore}/100`);
      console.log(`${"─".repeat(60)}\n`);
      console.log(`📝 Generating request summary and supplier explanations...`);
    }
    const [requestSummary, suppliersWithExplanations] = await Promise.all([
      generateRequestSummary(buyerRequest),
      Promise.all(
        topSuppliers.map(async (item, index) => {
          const explanation = await generateWhyTheyMatch(
            buyerRequest,
            item.supplier,
            item.matchScore,
            item.factors
          );
          return {
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: explanation,
            aiExplanation: explanation,
            strengths: [],
            concerns: [],
          };
        })
      ),
    ]);

    const reportData = {
      status: "completed",
      preview: {
        summary: requestSummary,
        category: buyerRequest.category,
        matchedCount: filteredSuppliers.length,
        matchScore: averageScore,
        previewSupplier: previewSupplier._id,
      },
      fullReport: {
        suppliers: suppliersWithExplanations,
        generatedAt: new Date(),
      },
    };

    if (!matchReport) {
      matchReport = new MatchReport({ requestId: id, email: buyerRequest.email, ...reportData });
    } else {
      Object.assign(matchReport, reportData);
    }
    await matchReport.save();

    buyerRequest.status = "processing";
    await buyerRequest.save();

    if (process.env.NODE_ENV === "development") {
      console.log(`✅ Hybrid match report generated with ${topSuppliers.length} suppliers`);
    }

    res.json({
      success: true,
      message: "Match report generated successfully",
      data: {
        requestId: id,
        matchReportId: matchReport._id,
        isUnlocked: matchReport.status === "unlocked",
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

    // If no match report exists, generate a rule-based preview (no AI)
    if (!matchReport) {
      const allSuppliers = await Supplier.find({ isActive: true });
      if (allSuppliers.length === 0) {
        return res.status(404).json({
          success: false,
          message: "No suppliers available",
        });
      }

      const filteredSuppliers = allSuppliers.filter((supplier) =>
        passesHardFilter(buyerRequest, supplier)
      );

      const suppliersWithScores = filteredSuppliers.map((supplier) => {
        const result = calculatePreviewScore(buyerRequest, supplier);
        return { supplier, matchScore: result.score, factors: result.factors };
      });

      suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
      const topSuppliers = suppliersWithScores.slice(0, 5);

      const previewSupplier = topSuppliers[0].supplier;
      const averageScore = Math.round(
        topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
      );
      const requestSummary = buyerRequest.description
        ? buyerRequest.description.substring(0, 200)
        : `Request for ${buyerRequest.name} in the ${buyerRequest.category} category.`;

      matchReport = new MatchReport({
        requestId: id,
        email: buyerRequest.email,
        status: "pending",
        preview: {
          summary: requestSummary,
          category: buyerRequest.category,
          matchedCount: filteredSuppliers.length,
          matchScore: averageScore,
          previewSupplier: previewSupplier._id,
        },
        fullReport: {
          suppliers: topSuppliers.map((item, index) => ({
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: item.factors.join(", "),
            aiExplanation: generateTemplateExplanation(
              buyerRequest,
              item.supplier,
              item.matchScore,
              item.factors
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

    // Return only preview data — strip all sensitive supplier fields
    res.json({
      success: true,
      data: {
        preview: {
          summary: matchReport.preview.summary,
          category: matchReport.preview.category,
          matchedCount: matchReport.preview.matchedCount,
          matchScore: matchReport.preview.matchScore,
        },
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
        // Include only safe display fields for the teaser supplier card
        previewSupplier: matchReport.preview.previewSupplier
          ? {
              category: matchReport.preview.previewSupplier.category,
              subCategory: matchReport.preview.previewSupplier.subCategory,
              stateRegion: matchReport.preview.previewSupplier.stateRegion,
              certifications:
                matchReport.preview.previewSupplier.certifications,
              lastVerifiedDate: matchReport.preview.previewSupplier.lastVerifiedDate,
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

    // Apply hard filter (category + subcategory) then hybrid score with Groq AI
    const allSuppliers = await Supplier.find({ isActive: true });

    if (allSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message: "No suppliers available in database",
      });
    }

    const filteredSuppliers = allSuppliers.filter((supplier) =>
      passesHardFilter(buyerRequest, supplier)
    );

    const postPaymentSubCategory = buyerRequest.subCategory ?? buyerRequest.subcategory;
    if (filteredSuppliers.length === 0) {
      return res.status(404).json({
        success: false,
        message:
          "No suppliers found matching your category" +
          (postPaymentSubCategory ? " and subcategory" : "") +
          ".",
      });
    }

    if (process.env.NODE_ENV === "development") {
      console.log(`\n${"─".repeat(60)}`);
      console.log(`[HYBRID SCORING - POST PAYMENT] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${postPaymentSubCategory ? ` > ${postPaymentSubCategory}` : ""}`);
      console.log(`Scoring ${filteredSuppliers.length} category-matched suppliers (OpenAI AI + rule-based)`);
      console.log(`─────────────────────────────────────────────────────────`);
    }

    const suppliersWithScores = await Promise.all(
      filteredSuppliers.map(async (supplier) => {
        const result = await calculateHybridScore(buyerRequest, supplier);
        return { supplier, matchScore: result.score, factors: result.factors };
      })
    );

    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
    const topSuppliers = suppliersWithScores.slice(0, 5);

    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
    );

    if (process.env.NODE_ENV === "development") {
      console.log(`─────────────────────────────────────────────────────────`);
      console.log(`[HYBRID RESULTS] Top ${topSuppliers.length} of ${filteredSuppliers.length} category-matched suppliers:`);
      topSuppliers.forEach((s, i) =>
        console.log(`  #${i + 1} ${s.supplier.name} — ${s.matchScore}/100`)
      );
      console.log(`  Total in category: ${filteredSuppliers.length} | Average score: ${averageScore}/100`);
      console.log(`${"─".repeat(60)}\n`);
      console.log(`📝 Generating request summary and supplier explanations...`);
    }
    const [requestSummary, suppliersWithExplanations] = await Promise.all([
      generateRequestSummary(buyerRequest),
      Promise.all(
        topSuppliers.map(async (item, index) => {
          const explanation = await generateWhyTheyMatch(
            buyerRequest,
            item.supplier,
            item.matchScore,
            item.factors
          );
          return {
            supplierId: item.supplier._id,
            matchScore: item.matchScore,
            ranking: index + 1,
            whyTheyMatch: explanation,
            aiExplanation: explanation,
            strengths: [],
            concerns: [],
          };
        })
      ),
    ]);

    // Update match report with AI-generated results
    // Set status to "completed" after AI matching (whether AI succeeds or fallback is used)
    matchReport.status = "completed";
    matchReport.preview = {
      summary: requestSummary,
      category: buyerRequest.category,
      matchedCount: filteredSuppliers.length,
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

    if (process.env.NODE_ENV === "development") {
      console.log(
        `✅ AI match report generated successfully with ${topSuppliers.length} suppliers`
      );
    }

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
