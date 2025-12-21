import mongoose from "mongoose";

const BuyerRequestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    unitPrice: {
      type: Number,
      required: [true, "Unit price is required"],
    },
    totalAmount: {
      type: Number,
      // Calculated field - will be set before save
    },
    quantity: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      trim: true,
    },
    timeline: {
      type: String,
      trim: true,
    },
    location: {
      type: String,
      trim: true,
    },
    requirements: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: [true, "Email is required"],
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, "Please provide a valid email address"],
    },
    status: {
      type: String,
      enum: ["pending", "processing", "completed", "pending_payment"],
      default: "pending",
    },
    // Keep budget for backward compatibility (deprecated)
    budget: {
      type: String,
      trim: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("BuyerRequest", BuyerRequestSchema);

