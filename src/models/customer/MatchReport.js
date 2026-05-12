import mongoose from "mongoose";

const MatchReportSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuyerRequest",
      required: true,
      unique: true,
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
    },
    status: {
      type: String,
      enum: [
        "pending",
        "scoring",
        "completed",
        "no_matches",
        "paid",
        "unlocked",
        "failed",
      ],
      default: "pending",
    },

    // --- AI matching redesign (see MATCHING_REDESIGN_SPEC.md) ---
    // requestSummary, scoredSuppliers, and scoringMeta are populated by the
    // new AI scoring pipeline. Legacy `preview` and `fullReport` below remain
    // for back-compat reads while the feature flag is rolled out.

    requestSummary: {
      type: String,
      maxlength: 240,
    },
    scoredSuppliers: [
      {
        supplierId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Supplier",
        },
        ranking: Number,
        // Populated by Call 1 (request creation)
        fitScore: Number,
        reason: { type: String, maxlength: 280 },
        meetsMoq: Boolean,
        meetsCompliance: Boolean,
        scoringMethod: {
          type: String,
          enum: ["ai", "ai_fallback_rule"],
        },
        // Populated by Call 2 (lazy on first /full GET after payment)
        whyTheyMatch: { type: String, maxlength: 800, default: null },
        strengths: [{ type: String, maxlength: 120 }],
        concerns: [{ type: String, maxlength: 120 }],
        explanationMethod: {
          type: String,
          enum: ["ai", "template_fallback"],
        },
      },
    ],
    scoringMeta: {
      call1: {
        method: { type: String, enum: ["ai", "rule_fallback"] },
        modelVersion: String,
        tokensIn: Number,
        tokensOut: Number,
        costUsdEstimate: Number,
        scoredAt: Date,
        thresholdUsed: Number,
        candidateCount: Number,
      },
      call2: {
        method: { type: String, enum: ["ai", "template_fallback"] },
        modelVersion: String,
        tokensIn: Number,
        tokensOut: Number,
        costUsdEstimate: Number,
        generatedAt: Date,
        matchedCount: Number,
      },
    },

    // --- Legacy subdocuments (kept for back-compat reads; new writes use
    // scoredSuppliers above) ---
    preview: {
      summary: String,
      category: String,
      matchedCount: Number,
      matchScore: Number,
      previewSupplier: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Supplier",
      },
    },
    fullReport: {
      suppliers: [
        {
          supplierId: {
            type: mongoose.Schema.Types.ObjectId,
            ref: "Supplier",
          },
          matchScore: Number,
          ranking: Number,
          whyTheyMatch: String,
          aiExplanation: String,
          strengths: [String],
          concerns: [String],
        },
      ],
      generatedAt: Date,
      manuallyEdited: {
        type: Boolean,
        default: false,
      },
      editedAt: Date,
      editedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
      },
    },
    paymentId: {
      type: String,
      trim: true,
    },
    paymentStatus: {
      type: String,
      enum: ["pending", "completed", "failed"],
    },
    unlockedAt: {
      type: Date,
    },
    manuallyEdited: {
      type: Boolean,
      default: false,
    },
    editedAt: {
      type: Date,
    },
    editedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
    adminNotes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for cost-cap queries (sum costUsdEstimate over last 24h)
MatchReportSchema.index({ "scoringMeta.call1.scoredAt": -1 });
MatchReportSchema.index({ "scoringMeta.call2.generatedAt": -1 });

// Defense-in-depth: when a MatchReport doc is serialized via res.json(), strip
// scoredSuppliers and scoringMeta so an accidental direct serialization
// doesn't leak below-threshold suppliers or cost telemetry to customers.
// Admin handlers use .toObject() explicitly which BYPASSES this transform,
// so admin views still see the full document (the intentional escape hatch
// per MATCHING_REDESIGN_SPEC.md §5.5).
MatchReportSchema.set("toJSON", {
  transform(_doc, ret) {
    delete ret.scoredSuppliers;
    delete ret.scoringMeta;
    return ret;
  },
});

export default mongoose.model("MatchReport", MatchReportSchema);
