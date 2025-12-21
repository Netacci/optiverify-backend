import mongoose from "mongoose";

const PaymentSchema = new mongoose.Schema(
  {
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuyerRequest",
      required: false, // Optional for top-up payments
    },
    matchReportId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "MatchReport",
      required: false, // Optional for managed services
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    stripePaymentIntentId: {
      type: String,
      trim: true,
    },
    stripeSessionId: {
      type: String,
      trim: true,
    },
    stripeCustomerId: {
      type: String,
      trim: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
    },
    amount: {
      type: Number,
      required: true,
    },
    currency: {
      type: String,
      default: "usd",
    },
    planType: {
      type: String,
      enum: [
        "one-time",
        "starter_monthly",
        "starter_annual",
        "professional_monthly",
        "professional_annual",
        "enterprise",
        "managed_service",
        "managed_service_savings_fee",
        "extra_credit",
      ],
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "succeeded", "failed", "canceled"],
      default: "pending",
    },
    paidAt: {
      type: Date,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Payment", PaymentSchema);
