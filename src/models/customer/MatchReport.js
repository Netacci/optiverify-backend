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
      enum: ["pending", "completed", "paid", "unlocked"],
      default: "pending",
    },
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

export default mongoose.model("MatchReport", MatchReportSchema);
