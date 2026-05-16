import BuyerRequest from "../../models/customer/BuyerRequest.js";
import Supplier from "../../models/admin/Supplier.js";
import MatchReport from "../../models/customer/MatchReport.js";
import {
  passesHardFilter,
  calculatePreviewScore,
  // calculateHybridScore — DISABLED. Single rule-based score (calculatePreviewScore)
  // is now used everywhere so preview and post-payment match numbers always agree.
  generateWhyTheyMatch,
  generateRequestSummary,
  generateTemplateExplanation,
} from "../../services/aiService.js";
import {
  scoreCandidatesBatch,
  generateExplanationsBatch,
  checkCostCap,
} from "../../services/aiScoringService.js";
import { verifyToken } from "../../services/tokenService.js";

// Matching redesign feature flag — see MATCHING_REDESIGN_SPEC.md.
// MATCH_SCORER=ai   → use the new AI scoring pipeline (Call 1 at request
//                     creation, Call 2 lazily on first /full GET).
// MATCH_SCORER=rule → keep existing rule-based path (default during rollout).
const MATCH_SCORER = (process.env.MATCH_SCORER || "rule").toLowerCase();
const MATCH_THRESHOLD = parseInt(
  process.env.MATCH_THRESHOLD_DEFAULT || "80",
  10
);

// Process request and match suppliers
export const processMatching = async (req, res) => {
  // Dispatch to the AI scoring pipeline when the feature flag is enabled.
  // See MATCHING_REDESIGN_SPEC.md §11 (rollout).
  if (MATCH_SCORER === "ai") {
    return processMatchingAi(req, res);
  }

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
      console.log(`[FULL MATCH] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${reqSubCategory ? ` > ${reqSubCategory}` : ""}`);
      console.log(`Scoring ${filteredSuppliers.length} category-matched suppliers (rule-based score + AI prose)`);
      console.log(`─────────────────────────────────────────────────────────`);
    }

    // Score everyone with the unified rule-based scorer. AI is no longer used
    // to compute the number — only to write the explanations below.
    const suppliersWithScores = filteredSuppliers.map((supplier) => {
      const result = calculatePreviewScore(buyerRequest, supplier);
      return { supplier, matchScore: result.score, factors: result.factors };
    });

    // Previously: const suppliersWithScores = await Promise.all(
    //   filteredSuppliers.map(async (supplier) => {
    //     const result = await calculateHybridScore(buyerRequest, supplier);
    //     return { supplier, matchScore: result.score, factors: result.factors };
    //   })
    // );

    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
    const topSuppliers = suppliersWithScores.slice(0, 5);

    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
    );

    if (process.env.NODE_ENV === "development") {
      console.log(`─────────────────────────────────────────────────────────`);
      console.log(`[FULL MATCH RESULTS] Top ${topSuppliers.length} of ${filteredSuppliers.length} category-matched suppliers:`);
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
      console.log(`✅ Match report generated with ${topSuppliers.length} suppliers (rule-based score + AI prose)`);
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

      // Crash-guard: if nothing passes the hard filter, persist a stub
      // no_matches report so the rest of this handler doesn't dereference
      // an empty array (previously crashed at topSuppliers[0].supplier).
      if (filteredSuppliers.length === 0) {
        const fallbackSummary =
          `${buyerRequest.name || "Request"} in ${buyerRequest.category} — ` +
          "no suppliers in our network for this category.";
        matchReport = new MatchReport({
          requestId: id,
          email: buyerRequest.email,
          status: "no_matches",
          requestSummary: fallbackSummary.substring(0, 240),
          preview: {
            summary: fallbackSummary.substring(0, 200),
            category: buyerRequest.category,
            matchedCount: 0,
            matchScore: 0,
          },
          fullReport: { suppliers: [], generatedAt: new Date() },
        });
        await matchReport.save();
      } else {
        const suppliersWithScores = filteredSuppliers.map((supplier) => {
          const result = calculatePreviewScore(buyerRequest, supplier);
          return {
            supplier,
            matchScore: result.score,
            factors: result.factors,
          };
        });

        suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
        const topSuppliers = suppliersWithScores.slice(0, 5);

        const previewSupplier = topSuppliers[0].supplier;
        const averageScore = Math.round(
          topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) /
            topSuppliers.length
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
    }

    // Get match report with suppliers populated to calculate fits
    const matchReportWithSuppliers = await MatchReport.findOne({
      requestId: id,
    }).populate("fullReport.suppliers.supplierId");

    // Per-supplier categoryFit / capabilityFit derivation. Hoisted into a
    // helper so we can build a card for each of the top-N preview suppliers.
    const buildFits = (supplier) => {
      let categoryFit = "N/A";
      let capabilityFit = "N/A";
      if (!supplier || !buyerRequest) return { categoryFit, capabilityFit };

      categoryFit =
        supplier.category?.toLowerCase() ===
        buyerRequest.category?.toLowerCase()
          ? "Perfect Match"
          : "Partial Match";

      const requestText = `${buyerRequest.description} ${
        buyerRequest.requirements || ""
      }`.toLowerCase();
      // Tags are a positioning signal alongside capabilities — fold them into
      // the same fit calculation so a tag hit (e.g. "Architecture") counts.
      const supplierKeywords = [
        ...(supplier.capabilities || []),
        ...(supplier.tags || []),
      ];
      const matchingKeywords = supplierKeywords.filter((kw) =>
        requestText.includes(String(kw).toLowerCase())
      );
      if (matchingKeywords.length > 0) {
        capabilityFit = `${matchingKeywords.length} Capabilities Match`;
      } else if (supplierKeywords.length > 0) {
        capabilityFit = "Capabilities Available";
      } else {
        capabilityFit = "Limited";
      }
      return { categoryFit, capabilityFit };
    };

    // Build the top-2 preview supplier cards from the populated fullReport.
    // We expose only safe display fields — name/contact stay locked behind
    // the paywall.
    const populatedTop = matchReportWithSuppliers?.fullReport?.suppliers || [];
    // Defense-in-depth: explicit server-side threshold filter so below-
    // threshold suppliers can never leak through /preview, even if a future
    // change populates fullReport.suppliers more permissively. See
    // MATCHING_REDESIGN_SPEC.md §5.2. Rule-based scoring has an 85 floor
    // (above the 80 threshold) so this is a no-op for the legacy path.
    const aboveThreshold = populatedTop.filter(
      (e) => (e?.matchScore ?? 0) >= MATCH_THRESHOLD
    );
    // Quick lookup for AI scoring metadata (fitScore + reason + badges) so the
    // frontend can show per-supplier fit info on the free preview cards.
    // Legacy rule-based reports won't have this — fields fall back to undefined.
    const scoredById = new Map();
    for (const s of matchReportWithSuppliers?.scoredSuppliers || []) {
      const sid = s.supplierId?._id
        ? s.supplierId._id.toString()
        : s.supplierId?.toString();
      if (sid) scoredById.set(sid, s);
    }
    const previewSuppliers = aboveThreshold.slice(0, 2).map((entry) => {
      const supplier = entry.supplierId;
      if (!supplier) return null;
      const sid = supplier._id ? supplier._id.toString() : null;
      const scored = sid ? scoredById.get(sid) : null;
      const { categoryFit, capabilityFit } = buildFits(supplier);
      return {
        category: supplier.category,
        subCategory: supplier.subCategory,
        industry: supplier.industry,
        stateRegion: supplier.stateRegion,
        certifications: supplier.certifications,
        lastVerifiedDate: supplier.lastVerifiedDate,
        categoryFit,
        capabilityFit,
        // AI matching fields (only present on AI-scored reports — see spec §5.2).
        // Below-threshold suppliers never reach here due to the filter above.
        fitScore: scored?.fitScore ?? entry.matchScore ?? null,
        reason: scored?.reason ?? null,
        meetsMoq: scored?.meetsMoq ?? null,
        meetsCompliance: scored?.meetsCompliance ?? null,
      };
    }).filter(Boolean);

    // Return only preview data — strip all sensitive supplier fields
    const isNoMatchesReport = matchReport.status === "no_matches";
    res.json({
      success: true,
      data: {
        preview: {
          summary: matchReport.preview.summary,
          category: matchReport.preview.category,
          matchedCount: matchReport.preview.matchedCount,
          matchScore: matchReport.preview.matchScore,
        },
        // Surface the no_matches signal explicitly so the frontend can render
        // a graceful CTA state instead of inferring from matchedCount === 0.
        matchReportStatus: matchReport.status,
        suggestedAction: isNoMatchesReport ? "managed_services" : undefined,
        requestSummary: matchReport.requestSummary || undefined,
        // Include buyer request details — frontend uses these to pre-populate
        // the "Try a different search" form on the no_matches state.
        request: buyerRequest
          ? {
              name: buyerRequest.name,
              category: buyerRequest.category,
              subCategory:
                buyerRequest.subCategory ?? buyerRequest.subcategory ?? "",
              unitPrice: buyerRequest.unitPrice,
              totalAmount: buyerRequest.totalAmount,
              quantity: buyerRequest.quantity,
              description: buyerRequest.description,
              timeline: buyerRequest.timeline,
              location: buyerRequest.location,
              requirements: buyerRequest.requirements,
            }
          : null,
        // Top-2 free preview supplier cards (was a single previewSupplier
        // before — kept the legacy shape commented out for revert).
        previewSuppliers,
        // Legacy single-card payload — superseded by previewSuppliers above.
        // previewSupplier: matchReport.preview.previewSupplier
        //   ? {
        //       category: matchReport.preview.previewSupplier.category,
        //       subCategory: matchReport.preview.previewSupplier.subCategory,
        //       stateRegion: matchReport.preview.previewSupplier.stateRegion,
        //       certifications:
        //         matchReport.preview.previewSupplier.certifications,
        //       lastVerifiedDate: matchReport.preview.previewSupplier.lastVerifiedDate,
        //       categoryFit,
        //       capabilityFit,
        //     }
        //   : null,
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

    // Matching redesign: when MATCH_SCORER=ai, route to the new AI pipeline.
    // It uses the soft category-only filter and returns 200 no_matches
    // instead of the legacy 404 when no suppliers pass. This handles the
    // customer-frontend post-payment flow where the matchReport may exist
    // (status "unlocked" from payment webhook) but Call 1 was never run.
    if (MATCH_SCORER === "ai") {
      return processMatchingAi(req, res);
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
      console.log(`[POST-PAYMENT MATCH] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${postPaymentSubCategory ? ` > ${postPaymentSubCategory}` : ""}`);
      console.log(`Scoring ${filteredSuppliers.length} category-matched suppliers (rule-based score + AI prose)`);
      console.log(`─────────────────────────────────────────────────────────`);
    }

    // Score with the unified rule-based scorer. The score will match the
    // number the user already saw on the public preview.
    const suppliersWithScores = filteredSuppliers.map((supplier) => {
      const result = calculatePreviewScore(buyerRequest, supplier);
      return { supplier, matchScore: result.score, factors: result.factors };
    });

    // Previously: const suppliersWithScores = await Promise.all(
    //   filteredSuppliers.map(async (supplier) => {
    //     const result = await calculateHybridScore(buyerRequest, supplier);
    //     return { supplier, matchScore: result.score, factors: result.factors };
    //   })
    // );

    suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
    const topSuppliers = suppliersWithScores.slice(0, 5);

    const previewSupplier = topSuppliers[0].supplier;
    const averageScore = Math.round(
      topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) / topSuppliers.length
    );

    if (process.env.NODE_ENV === "development") {
      console.log(`─────────────────────────────────────────────────────────`);
      console.log(`[POST-PAYMENT RESULTS] Top ${topSuppliers.length} of ${filteredSuppliers.length} category-matched suppliers:`);
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

    const matchReport = await MatchReport.findOne({ requestId: id })
      .populate("fullReport.suppliers.supplierId")
      .populate("scoredSuppliers.supplierId");

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

    // Lazy Call 2 firing: if AI scored the report at Call 1 time, and the
    // buyer has paid (status: paid|unlocked), and prose hasn't been generated
    // yet, fire Call 2 now and persist. See MATCHING_REDESIGN_SPEC.md §5.4.
    // MUST run AFTER auth checks above so an unauthenticated request can't
    // trigger paid AI calls (security audit H1).
    await maybeFireCall2(matchReport);

    // Return full report with all supplier details — but only those above
    // the match threshold. Defense-in-depth filter per MATCHING_REDESIGN_SPEC.md
    // §5.4 — below-threshold suppliers stay in scoredSuppliers for audit but
    // never reach the buyer.
    // Build a quick lookup for AI scoring metadata (fitScore, reason, badges).
    // Legacy rule-based reports won't have entries here; fields fall back.
    const fullScoredById = new Map();
    for (const s of matchReport.scoredSuppliers || []) {
      const sid = s.supplierId?._id
        ? s.supplierId._id.toString()
        : s.supplierId?.toString();
      if (sid) fullScoredById.set(sid, s);
    }
    const fullSuppliers = matchReport.fullReport.suppliers
      .filter((item) => (item?.matchScore ?? 0) >= MATCH_THRESHOLD)
      .map((item) => {
      const supplier = item.supplierId;
      const sid = supplier?._id ? supplier._id.toString() : null;
      const scored = sid ? fullScoredById.get(sid) : null;
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
        // AI matching fields — null on legacy rule-based reports.
        fitScore: scored?.fitScore ?? item.matchScore ?? null,
        reason: scored?.reason ?? null,
        meetsMoq: scored?.meetsMoq ?? null,
        meetsCompliance: scored?.meetsCompliance ?? null,
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

// ============================================================================
// AI scoring path (MATCH_SCORER=ai). See MATCHING_REDESIGN_SPEC.md.
// ============================================================================

const isDevMatchAi = process.env.NODE_ENV === "development";

// Concurrency guard for the lazy Call 2 fire (security audit C2).
// Key: matchReportId. Value: in-flight Promise. SINGLE-INSTANCE ONLY —
// for multi-instance deployment, replace with a Redis SETNX or a
// findOneAndUpdate-based DB lock. Today's deployment is single-instance,
// so this is sufficient to prevent same-process double-billing.
const call2InFlight = new Map();

function parseQuantityNumberLocal(text) {
  if (!text) return null;
  const m = String(text).match(/\d[\d,]*/);
  return m ? parseInt(m[0].replace(/,/g, ""), 10) : null;
}

function checkMoqBoolean(buyerRequest, supplier) {
  if (!supplier.minOrderQuantity) return true;
  if (!buyerRequest.quantity) return true;
  const supplierMoq = parseQuantityNumberLocal(supplier.minOrderQuantity);
  const buyerQty = parseQuantityNumberLocal(buyerRequest.quantity);
  if (supplierMoq === null || buyerQty === null) return true;
  return buyerQty >= supplierMoq;
}

function checkComplianceBoolean(buyerRequest, supplier) {
  if (!buyerRequest.requirements) return true;
  const reqText = String(buyerRequest.requirements).toLowerCase();
  const certs = (supplier.certifications || []).map((c) =>
    String(c).toLowerCase()
  );
  if (certs.length === 0) return false;
  return certs.some((c) => reqText.includes(c));
}

async function processMatchingAi(req, res) {
  try {
    const { id } = req.params;

    const buyerRequest = await BuyerRequest.findById(id);
    if (!buyerRequest) {
      return res
        .status(404)
        .json({ success: false, message: "Request not found" });
    }

    let matchReport = await MatchReport.findOne({ requestId: id });

    // Idempotent: if already completed (or no_matches), return existing.
    if (
      matchReport &&
      ["completed", "no_matches"].includes(matchReport.status)
    ) {
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

    const allSuppliers = await Supplier.find({ isActive: true });
    if (allSuppliers.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "No suppliers available in database" });
    }

    // Matching redesign: subCategory is now a SOFT signal handled by AI
    // scoring, not a hard gate. Buyers often pick a granular subCategory
    // (e.g. "Print, Imaging & IT Services") that no supplier is filed under,
    // even when generalist IT suppliers (CDW, SHI) credibly cover the request.
    // We let AI judge fit across all supplier fields including internalNotes.
    const reqCat = String(buyerRequest.category || "")
      .toLowerCase()
      .trim();
    const filteredSuppliers = allSuppliers.filter((s) => {
      const supCat = String(s.category || "").toLowerCase().trim();
      return reqCat && supCat && reqCat === supCat;
    });
    const reqSubCategory =
      buyerRequest.subCategory ?? buyerRequest.subcategory;
    if (isDevMatchAi && reqSubCategory) {
      console.log(
        `[AI MATCH] subCategory "${reqSubCategory}" not enforced as hard filter — letting AI judge fit across capabilities/internalNotes`
      );
    }
    if (filteredSuppliers.length === 0) {
      // Zero suppliers in the buyer's category at all → persist a no_matches
      // report so the frontend can render the managed-services CTA via the
      // standard no_matches flow (not a 404 / generic error).
      const fallbackSummary =
        `${buyerRequest.name || "Request"} in ${buyerRequest.category} — ` +
        "no suppliers in our network for this category.";
      const noMatchesData = {
        status: "no_matches",
        requestSummary: fallbackSummary.substring(0, 240),
        scoredSuppliers: [],
        scoringMeta: {
          call1: {
            method: "rule_fallback",
            scoredAt: new Date(),
            candidateCount: 0,
            thresholdUsed: MATCH_THRESHOLD,
          },
        },
        preview: {
          summary: fallbackSummary.substring(0, 200),
          category: buyerRequest.category,
          matchedCount: 0,
          matchScore: 0,
        },
        fullReport: { suppliers: [], generatedAt: new Date() },
      };
      if (!matchReport) {
        matchReport = new MatchReport({
          requestId: id,
          email: buyerRequest.email,
          ...noMatchesData,
        });
      } else {
        Object.assign(matchReport, noMatchesData);
      }
      await matchReport.save();
      return res.json({
        success: true,
        message: "No suppliers in our network for this category.",
        data: {
          requestId: id,
          matchReportId: matchReport._id,
          status: "no_matches",
          candidateCount: 0,
          matchedCount: 0,
          requestSummary: noMatchesData.requestSummary,
          suggestedAction: "managed_services",
        },
      });
    }

    if (isDevMatchAi) {
      console.log(`\n${"─".repeat(60)}`);
      console.log(
        `[AI MATCH] Request: "${buyerRequest.name}" | Category: ${buyerRequest.category}${reqSubCategory ? ` > ${reqSubCategory}` : ""}`
      );
      console.log(
        `Scoring ${filteredSuppliers.length} category-matched suppliers via AI Call 1`
      );
    }

    // Cost cap check — hard cap means we cannot use AI for the rest of
    // the day. Surface as a failure (NOT silent rule-based fallback —
    // rule-based has the 85-point floor bug we set out to fix).
    const capCheck = await checkCostCap();
    if (capCheck.status === "hard") {
      console.warn(
        `[AI MATCH] Hard cost cap exceeded ($${capCheck.dailyTotal.toFixed(2)}); returning failed status`
      );
      return persistFailedMatchReport(
        req,
        res,
        buyerRequest,
        matchReport,
        "cost_cap_exceeded",
        `Daily AI spending cap reached ($${capCheck.dailyTotal.toFixed(2)}).`,
        filteredSuppliers.length
      );
    }

    // Try Call 1 with internal retries (scoreCandidatesBatch wraps the
    // OpenAI call in withRetry). If it still fails after retries, surface
    // as failed — do NOT fall through to rule-based scoring, which would
    // return misleading 85+ floor scores for irrelevant suppliers.
    let aiResult = null;
    try {
      aiResult = await scoreCandidatesBatch(buyerRequest, filteredSuppliers);
    } catch (err) {
      console.error(
        `[AI MATCH] Call 1 failed after retries — returning failed status:`,
        err.message
      );
      return persistFailedMatchReport(
        req,
        res,
        buyerRequest,
        matchReport,
        "ai_unavailable",
        err.message,
        filteredSuppliers.length
      );
    }

    // AI succeeded — build scoredSuppliers
    const suppliersById = new Map(
      filteredSuppliers.map((s) => [s._id.toString(), s])
    );

    const scored = aiResult.scores
      .map((score) => {
        const supplier = suppliersById.get(score.supplier_id);
        if (!supplier) return null;
        return {
          supplierId: supplier._id,
          fitScore: score.fit_score,
          reason: score.reason,
          meetsMoq: checkMoqBoolean(buyerRequest, supplier),
          meetsCompliance: checkComplianceBoolean(buyerRequest, supplier),
          scoringMethod: "ai",
          whyTheyMatch: null,
          strengths: [],
          concerns: [],
          // explanationMethod unset until Call 2 fires
        };
      })
      .filter(Boolean)
      .sort((a, b) => b.fitScore - a.fitScore);

    scored.forEach((s, i) => {
      s.ranking = i + 1;
    });

    const matched = scored.filter((s) => s.fitScore >= MATCH_THRESHOLD);
    const matchedCount = matched.length;

    if (isDevMatchAi) {
      console.log(
        `[AI MATCH] Scored ${scored.length} suppliers; ${matchedCount} above threshold ${MATCH_THRESHOLD}`
      );
      scored.slice(0, 5).forEach((s, i) => {
        const sup = suppliersById.get(s.supplierId.toString());
        console.log(
          `  #${i + 1} ${sup.name} — ${s.fitScore}/100 — ${String(s.reason).substring(0, 80)}`
        );
      });
      console.log(`${"─".repeat(60)}\n`);
    }

    const reportData = {
      requestSummary: aiResult.requestSummary,
      scoredSuppliers: scored,
      scoringMeta: {
        call1: {
          method: "ai",
          modelVersion: aiResult.usage.modelVersion,
          tokensIn: aiResult.usage.tokensIn,
          tokensOut: aiResult.usage.tokensOut,
          costUsdEstimate: aiResult.usage.costUsdEstimate,
          scoredAt: new Date(),
          thresholdUsed: MATCH_THRESHOLD,
          candidateCount: filteredSuppliers.length,
        },
      },
      status: matchedCount === 0 ? "no_matches" : "completed",
    };

    // Back-compat: also populate legacy preview/fullReport so existing
    // frontend reads continue to work during rollout. New endpoints should
    // read from scoredSuppliers directly.
    if (matchedCount > 0) {
      const topMatched = matched.slice(0, 5);
      const previewTop = matched[0];
      const averageScore = Math.round(
        topMatched.reduce((sum, s) => sum + s.fitScore, 0) /
          topMatched.length
      );

      reportData.preview = {
        summary: aiResult.requestSummary,
        category: buyerRequest.category,
        matchedCount,
        matchScore: averageScore,
        previewSupplier: previewTop.supplierId,
      };
      reportData.fullReport = {
        suppliers: topMatched.map((m) => ({
          supplierId: m.supplierId,
          matchScore: m.fitScore,
          ranking: m.ranking,
          whyTheyMatch: m.reason, // enriched by Call 2 on first /full GET
          aiExplanation: m.reason,
          strengths: [],
          concerns: [],
        })),
        generatedAt: new Date(),
      };
    } else {
      reportData.preview = {
        summary: aiResult.requestSummary,
        category: buyerRequest.category,
        matchedCount: 0,
        matchScore: 0,
      };
      reportData.fullReport = { suppliers: [], generatedAt: new Date() };
    }

    if (!matchReport) {
      matchReport = new MatchReport({
        requestId: id,
        email: buyerRequest.email,
        ...reportData,
      });
    } else {
      Object.assign(matchReport, reportData);
    }
    await matchReport.save();

    if (matchedCount === 0) {
      return res.json({
        success: true,
        message: "No strong matches found in our network.",
        data: {
          requestId: id,
          matchReportId: matchReport._id,
          status: "no_matches",
          candidateCount: filteredSuppliers.length,
          matchedCount: 0,
          requestSummary: aiResult.requestSummary,
          suggestedAction: "managed_services",
        },
      });
    }

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
  } catch (error) {
    console.error("[processMatchingAi] Unexpected error:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error:
        process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
}

/**
 * Lazy-fire AI Call 2 (explanations) when the buyer opens /full after
 * payment, IF the report was AI-scored at Call 1 time AND prose hasn't
 * been generated yet. See MATCHING_REDESIGN_SPEC.md §5.4.
 *
 * Mutates the matchReport in place and saves on success or template-fallback.
 * Returns silently on no-op (already populated, wrong status, not AI-scored).
 */
export async function maybeFireCall2(matchReport) {
  if (MATCH_SCORER !== "ai") return;
  // Concurrency guard (security audit C2). If another request is already
  // firing Call 2 for this report, wait for it and return — don't fire a
  // duplicate. Caller's matchReport instance will be stale after this, but
  // the DB has the fresh data and the next request will see it.
  const _lockId = matchReport._id.toString();
  if (call2InFlight.has(_lockId)) {
    if (isDevMatchAi) {
      console.log(
        `[AI MATCH /full] Call 2 already in flight for ${_lockId}; awaiting and returning`
      );
    }
    try {
      await call2InFlight.get(_lockId);
    } catch (_) {
      /* swallow — the in-flight call's error is logged by its own owner */
    }
    return;
  }
  const _work = doMaybeFireCall2(matchReport);
  call2InFlight.set(_lockId, _work);
  try {
    await _work;
  } finally {
    call2InFlight.delete(_lockId);
  }
}

async function doMaybeFireCall2(matchReport) {
  const wasAiScored = matchReport.scoringMeta?.call1?.method === "ai";
  const hasAccessOrPaid = ["paid", "unlocked", "completed"].includes(
    matchReport.status
  );
  if (!wasAiScored || !hasAccessOrPaid) return;

  const scoredSuppliers = matchReport.scoredSuppliers || [];
  const matched = scoredSuppliers.filter((s) => s.fitScore >= MATCH_THRESHOLD);
  if (matched.length === 0) return;

  const needsCall2 = matched.some((s) => !s.whyTheyMatch);
  if (!needsCall2) return;

  // Build payload — requires Supplier docs populated on scoredSuppliers.
  const matchedForCall2 = matched
    .map((s) => ({
      supplier: s.supplierId,
      fitScore: s.fitScore,
      reason: s.reason,
    }))
    .filter((m) => m.supplier && typeof m.supplier === "object" && m.supplier._id);

  if (matchedForCall2.length === 0) {
    console.warn(
      `[AI MATCH /full] No populated Supplier docs for Call 2; skipping (matchReport ${matchReport._id})`
    );
    return;
  }

  const buyerRequest = await BuyerRequest.findById(matchReport.requestId);
  if (!buyerRequest) {
    console.warn(
      `[AI MATCH /full] BuyerRequest not found for Call 2 (matchReport ${matchReport._id})`
    );
    return;
  }

  if (isDevMatchAi) {
    console.log(
      `[AI MATCH /full] Firing Call 2 for ${matchedForCall2.length} matched suppliers (matchReport ${matchReport._id})`
    );
  }

  // Cost cap check
  const capCheck = await checkCostCap();
  let explanationsResult = null;
  let useTemplate = false;

  if (capCheck.status === "hard") {
    if (isDevMatchAi) {
      console.log(
        `[AI MATCH /full] Hard cost cap exceeded ($${capCheck.dailyTotal.toFixed(2)}), using template fallback`
      );
    }
    useTemplate = true;
  } else {
    try {
      explanationsResult = await generateExplanationsBatch(
        buyerRequest,
        matchedForCall2
      );
    } catch (err) {
      console.error(
        `[AI MATCH /full] Call 2 failed, using template fallback:`,
        err.message
      );
      useTemplate = true;
    }
  }

  const idOf = (ref) =>
    ref && typeof ref === "object" && ref._id
      ? ref._id.toString()
      : ref?.toString?.();

  if (explanationsResult) {
    const explById = new Map(
      explanationsResult.explanations.map((e) => [e.supplier_id, e])
    );

    for (const s of matchReport.scoredSuppliers) {
      const e = explById.get(idOf(s.supplierId));
      if (!e) continue;
      s.whyTheyMatch = e.why_they_match;
      s.strengths = e.strengths;
      s.concerns = e.concerns;
      s.explanationMethod = "ai";
    }

    if (matchReport.fullReport && Array.isArray(matchReport.fullReport.suppliers)) {
      for (const item of matchReport.fullReport.suppliers) {
        const e = explById.get(idOf(item.supplierId));
        if (!e) continue;
        item.whyTheyMatch = e.why_they_match;
        item.aiExplanation = e.why_they_match;
        item.strengths = e.strengths;
        item.concerns = e.concerns;
      }
    }

    matchReport.scoringMeta = matchReport.scoringMeta || {};
    matchReport.scoringMeta.call2 = {
      method: "ai",
      modelVersion: explanationsResult.usage.modelVersion,
      tokensIn: explanationsResult.usage.tokensIn,
      tokensOut: explanationsResult.usage.tokensOut,
      costUsdEstimate: explanationsResult.usage.costUsdEstimate,
      generatedAt: new Date(),
      matchedCount: matchedForCall2.length,
    };
  } else if (useTemplate) {
    for (const s of matchReport.scoredSuppliers) {
      if (s.fitScore < MATCH_THRESHOLD) continue;
      if (s.whyTheyMatch) continue;
      const supplier = s.supplierId;
      if (!supplier || typeof supplier !== "object") continue;
      const factors = String(s.reason || "")
        .split(",")
        .map((x) => x.trim())
        .filter(Boolean);
      const explanation = generateTemplateExplanation(
        buyerRequest,
        supplier,
        s.fitScore,
        factors
      );
      s.whyTheyMatch = String(explanation).substring(0, 800);
      s.strengths = [];
      s.concerns = [];
      s.explanationMethod = "template_fallback";
    }

    if (matchReport.fullReport && Array.isArray(matchReport.fullReport.suppliers)) {
      for (const item of matchReport.fullReport.suppliers) {
        if (item.aiExplanation) continue;
        const supplier = item.supplierId;
        if (!supplier || typeof supplier !== "object") continue;
        const factors = String(item.whyTheyMatch || "")
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean);
        item.aiExplanation = generateTemplateExplanation(
          buyerRequest,
          supplier,
          item.matchScore,
          factors
        );
      }
    }

    matchReport.scoringMeta = matchReport.scoringMeta || {};
    matchReport.scoringMeta.call2 = {
      method: "template_fallback",
      generatedAt: new Date(),
      matchedCount: matchedForCall2.length,
    };
  }

  matchReport.markModified("scoredSuppliers");
  matchReport.markModified("fullReport.suppliers");
  matchReport.markModified("scoringMeta");
  await matchReport.save();
}

/**
 * Persist a failed match report and return a clean failure response.
 *
 * Used when:
 *  - AI Call 1 throws after exhausting retries (transient errors give up,
 *    or permanent errors like 4xx from OpenAI)
 *  - Daily hard cost cap has been tripped
 *
 * IMPORTANT: We deliberately do NOT silently fall back to rule-based
 * scoring here. Rule-based has the 85-point floor bug we set out to fix —
 * returning misleading 91-98 scores for irrelevant suppliers is worse for
 * the buyer than an honest failure. The frontend renders this as an error
 * state with a Retry button that re-triggers processMatchingAi.
 *
 * reasonCode: 'ai_unavailable' | 'cost_cap_exceeded'
 * reasonMessage: human-readable error from the underlying failure
 */
async function persistFailedMatchReport(
  req,
  res,
  buyerRequest,
  matchReport,
  reasonCode,
  reasonMessage,
  candidateCount
) {
  const summary = `Matching couldn't be completed for ${buyerRequest.name || "this request"}.`;
  const failureData = {
    status: "failed",
    requestSummary: summary.substring(0, 240),
    scoredSuppliers: [],
    scoringMeta: {
      call1: {
        method: "rule_fallback", // sentinel — schema only allows "ai" | "rule_fallback"
        scoredAt: new Date(),
        candidateCount: candidateCount ?? 0,
        thresholdUsed: MATCH_THRESHOLD,
      },
    },
    preview: {
      summary: summary.substring(0, 200),
      category: buyerRequest.category,
      matchedCount: 0,
      matchScore: 0,
    },
    fullReport: { suppliers: [], generatedAt: new Date() },
  };

  if (!matchReport) {
    matchReport = new MatchReport({
      requestId: req.params.id,
      email: buyerRequest.email,
      ...failureData,
    });
  } else {
    Object.assign(matchReport, failureData);
  }
  await matchReport.save();

  // 503 (Service Unavailable) for AI/cost-cap failures so the frontend can
  // treat it as a retryable error rather than a permanent one.
  return res.status(503).json({
    success: false,
    message: "We couldn't generate matches right now. Please retry shortly.",
    data: {
      requestId: req.params.id,
      matchReportId: matchReport._id,
      status: "failed",
      failureReason: reasonCode,
      failureDetail:
        process.env.NODE_ENV === "development" ? reasonMessage : undefined,
      candidateCount: candidateCount ?? 0,
      suggestedAction: "retry",
    },
  });
}

/**
 * Rule-based fallback (LEGACY — no longer wired into processMatchingAi).
 *
 * Retained for back-compat with the non-AI legacy path (MATCH_SCORER=rule)
 * and for admin-triggered re-scoring tools. The new AI path now uses
 * persistFailedMatchReport instead, because rule-based scoring's 85-point
 * floor produces misleading "great match" scores for irrelevant suppliers.
 */
async function runRuleBasedFallback(
  req,
  res,
  buyerRequest,
  filteredSuppliers,
  matchReport
) {
  const suppliersWithScores = filteredSuppliers.map((supplier) => {
    const result = calculatePreviewScore(buyerRequest, supplier);
    return { supplier, matchScore: result.score, factors: result.factors };
  });

  suppliersWithScores.sort((a, b) => b.matchScore - a.matchScore);
  const topSuppliers = suppliersWithScores.slice(0, 5);

  const previewSupplier = topSuppliers[0].supplier;
  const averageScore = Math.round(
    topSuppliers.reduce((sum, s) => sum + s.matchScore, 0) /
      topSuppliers.length
  );

  const requestSummary = buyerRequest.description
    ? buyerRequest.description.substring(0, 200)
    : `Request for ${buyerRequest.name} in the ${buyerRequest.category} category.`;

  const scoredSuppliers = suppliersWithScores.map((item, i) => ({
    supplierId: item.supplier._id,
    ranking: i + 1,
    fitScore: item.matchScore,
    reason: (item.factors || []).join(", "),
    meetsMoq: checkMoqBoolean(buyerRequest, item.supplier),
    meetsCompliance: checkComplianceBoolean(buyerRequest, item.supplier),
    scoringMethod: "ai_fallback_rule",
    whyTheyMatch: null,
    strengths: [],
    concerns: [],
  }));

  const reportData = {
    status: "pending",
    requestSummary,
    scoredSuppliers,
    scoringMeta: {
      call1: {
        method: "rule_fallback",
        scoredAt: new Date(),
        candidateCount: filteredSuppliers.length,
        thresholdUsed: MATCH_THRESHOLD,
      },
    },
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
        whyTheyMatch: (item.factors || []).join(", "),
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
    matchReport = new MatchReport({
      requestId: req.params.id,
      email: buyerRequest.email,
      ...reportData,
    });
  } else {
    Object.assign(matchReport, reportData);
  }
  await matchReport.save();

  return res.json({
    success: true,
    message: "Preview match generated. Unlock to see full supplier details.",
    data: {
      requestId: req.params.id,
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
