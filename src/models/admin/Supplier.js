import mongoose from "mongoose";

const SupplierSchema = new mongoose.Schema(
  {
    // Basic Information
    name: {
      type: String,
      required: true,
      trim: true,
    },
    category: {
      type: String,
      required: true,
      trim: true,
      index: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    description: {
      type: String,
      required: true,
    },
    // Location Information
    location: {
      type: String,
      required: true,
      trim: true,
    },
    country: {
      type: String,
      trim: true,
    },
    stateRegion: {
      type: String,
      trim: true,
    },
    city: {
      type: String,
      trim: true,
    },
    // Contact Information
    contactName: {
      type: String,
      trim: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    phone: {
      type: String,
      trim: true,
    },
    website: {
      type: String,
      trim: true,
    },
    // Certifications & Diversity
    certifications: {
      type: [String],
      default: [],
    },
    diversityType: {
      type: String,
      trim: true,
    },
    // Products & Services
    capabilities: {
      type: [String],
      default: [],
    },
    // Order & Capacity Information
    minOrderQuantity: {
      type: String,
      trim: true,
    },
    leadTime: {
      type: String,
      trim: true,
    },
    annualCapacity: {
      type: String,
      trim: true,
    },
    // Industry & Risk
    industry: {
      type: String,
      trim: true,
    },
    riskFlags: {
      type: String,
      trim: true,
    },
    // Data Management
    dataSource: {
      type: String,
      trim: true,
    },
    // Verification & Status
    isActive: {
      type: Boolean,
      default: true,
    },
    verified: {
      type: Boolean,
      default: false,
    },
    lastVerifiedDate: {
      type: Date,
    },
    // Internal Management
    internalNotes: {
      type: String,
      trim: true,
    },
    buyerMatchRecommendation: {
      type: String,
      trim: true,
    },
    // Search & Keywords
    keywords: {
      type: [String],
      default: [],
      index: true,
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Supplier", SupplierSchema);
