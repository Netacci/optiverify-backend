import mongoose from "mongoose";

const BuyerRequestSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: [true, "Name is required"],
      trim: true,
      maxlength: [200, "Name must be 200 characters or less"],
    },
    category: {
      type: String,
      required: [true, "Category is required"],
      trim: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    // Legacy: kept for reading old documents that have "subcategory" in DB
    subcategory: {
      type: String,
      trim: true,
      select: true,
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
      maxlength: [2000, "Description must be 2000 characters or less"],
    },
    timeline: {
      type: String,
      trim: true,
      maxlength: [200, "Timeline must be 200 characters or less"],
    },
    location: {
      type: String,
      trim: true,
      maxlength: [200, "Location must be 200 characters or less"],
    },
    requirements: {
      type: String,
      trim: true,
      maxlength: [1000, "Requirements must be 1000 characters or less"],
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
