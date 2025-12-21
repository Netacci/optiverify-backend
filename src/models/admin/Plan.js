import mongoose from "mongoose";

const PlanSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
      trim: true,
    },
    planType: {
      type: String,
      required: true,
      unique: true,
      enum: [
        "basic",
        "starter",
        "professional",
      ],
    },
    description: {
      type: String,
      trim: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    hasAnnualPricing: {
      type: Boolean,
      default: false,
    },
    annualPrice: {
      type: Number,
      min: 0,
    },
    credits: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
    },
    features: {
      type: [String],
      default: [],
    },
    maxRolloverCredits: {
      type: Number,
      default: 0,
      min: 0,
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    displayOrder: {
      type: Number,
      default: 0,
    },
    isPopular: {
      type: Boolean,
      default: false,
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

// Index for efficient queries
PlanSchema.index({ planType: 1 });
PlanSchema.index({ isActive: 1, displayOrder: 1 });

export default mongoose.model("Plan", PlanSchema);

