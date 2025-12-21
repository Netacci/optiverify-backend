import mongoose from "mongoose";

const CreditTransactionSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuyerRequest",
      required: false, // Optional if credits used for other purposes
    },
    matchReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MatchReport",
      required: false, // Optional if credits used for other purposes
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    creditsUsed: {
      type: Number,
      required: true,
      default: 1,
    },
    creditsBefore: {
      type: Number,
      required: true,
    },
    creditsAfter: {
      type: Number,
      required: true,
    },
    transactionType: {
      type: String,
      enum: [
        "deducted", // Credit was used/deducted
        "added", // Credit was added (e.g., from payment)
        "expired", // Credit expired (future use)
      ],
      default: "deducted",
    },
    reason: {
      type: String,
      enum: [
        "match_generation", // Used for AI match generation
        "unlock_request", // Used to unlock a request
        "subscription_allocation", // Credits added from subscription
        "top_up", // Credits added from top-up payment
        "rollover", // Credits rolled over from previous period
      ],
      required: true,
    },
    notes: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

// Index for efficient queries
CreditTransactionSchema.index({ userId: 1, createdAt: -1 });
CreditTransactionSchema.index({ requestId: 1 });
CreditTransactionSchema.index({ email: 1, createdAt: -1 });

export default mongoose.model("CreditTransaction", CreditTransactionSchema);

