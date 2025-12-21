import mongoose from "mongoose";

const SystemSettingsSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      unique: true,
      default: "pricing_config", // We'll use a single document for now with this key
    },
    savingsFeePercentage: {
      type: Number,
      default: 8, // 8% of savings
    },
    // Managed Service Pricing
    gradePrices: {
      type: Map,
      of: Number,
      default: () => new Map([
        ["low", 750],
        ["medium", 1500],
        ["high", 2500],
      ]),
    },
    urgencyFees: {
      type: Map,
      of: {
        fee: Number,
        duration: String, // e.g., "5-7 days", "2-3 days", "24-48 hrs"
      },
      default: () => new Map([
        ["standard", { fee: 0, duration: "5-7 days" }],
        ["expedited", { fee: 500, duration: "2-3 days" }],
        ["emergency", { fee: 1000, duration: "24-48 hrs" }],
      ]),
    },
    // Extra credit pricing (for top-ups)
    extraCreditPrice: {
      type: Number,
      default: 10, // $10 per credit (top-up)
    },
    currency: {
      type: String,
      default: "USD",
    },
    updatedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("SystemSettings", SystemSettingsSchema);
