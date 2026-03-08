import mongoose from "mongoose";

const ManagedServiceSchema = new mongoose.Schema(
  {
    // Customer Info
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: false, // Allow null for public submissions before user registration
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },

    // Request Details
    itemName: {
      type: String,
      required: true,
    },
    category: {
      type: String,
      required: true,
    },
    subCategory: {
      type: String,
      trim: true,
    },
    // Legacy: kept for reading old documents
    subcategory: {
      type: String,
      trim: true,
    },
    quantity: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    estimatedSpendRange: {
      type: String,
      required: true,
    },
    urgency: {
      type: String,
      required: true,
      default: "standard",
    },
    complianceLevel: {
      type: String,
      enum: ["commercial", "government", "regulated"],
      required: true,
      default: "commercial",
    },
    deliveryLocation: {
      type: String,
      required: true,
    },
    internalDeadline: {
      type: Date,
    },
    // Legacy fields (keeping for backward compatibility, but specifications maps to description)
    specifications: {
      type: String,
    },
    deliveryLocation: {
      type: String,
    },
    budget: {
      type: String,
    },
    deadline: {
      type: String,
    },
    attachments: [
      {
        name: String,
        url: String, // URL to stored file (if we implement file upload later)
      },
    ],

    // Workflow Status
    status: {
      type: String,
      enum: [
        "pending_payment", // Created but $199 not paid
        "in_progress", // Paid, admin working
        "action_required", // Waiting for customer (e.g. pay savings fee)
        "completed", // Finished
        "cancelled",
      ],
      default: "pending_payment",
    },

    // Detailed Stage (What the customer sees on timeline)
    stage: {
      type: String,
      enum: [
        "payment_pending", // Step 2/3: Customer needs to pay service fee
        "review", // Step 1 (Admin): Review request
        "rfq_prep", // Step 3: Prepare RFQ package
        "supplier_outreach", // Step 4: Reach out to suppliers
        "collecting_quotes", // Step 5: Collect quotes
        "negotiating", // Step 6-7: Compare & Negotiate
        "report_ready", // Step 8: Report created (Waiting for unlock if savings)
        "final_report", // Step 9: Present recommended supplier (Unlocked)
      ],
      default: "payment_pending",
    },

    // Admin Notes & Internal Tracking
    adminNotes: {
      type: String,
    },
    assignedAdmin: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Admin",
    },

    // Financials - Upfront Service Fee
    serviceFeeAmount: {
      type: Number,
      required: true, // e.g., 199
    },
    serviceFeeStatus: {
      type: String,
      enum: ["pending", "paid", "failed"],
      default: "pending",
    },
    serviceFeePaymentId: {
      type: String, // Stripe Payment Intent ID
    },
    serviceFeePaidAt: {
      type: Date,
    },
    // Set when we send any payment email (receipt or verification) for this service fee.
    // Used so only one code path (webhook or syncPaymentStatus) sends, and webhook retries never resend.
    serviceFeeEmailSentAt: {
      type: Date,
    },

    // Financials - Savings Fee (The 8%)
    originalPrice: {
      type: Number, // Buyer's original budget/price expectation
    },
    negotiatedPrice: {
      type: Number, // Best price found by admin
    },
    savingsAmount: {
      type: Number, // original - negotiated
    },
    savingsFeePercentage: {
      type: Number, // Snapshot of the % at time of calculation (e.g., 8)
    },
    savingsFeeAmount: {
      type: Number, // Calculated fee
    },
    savingsFeeStatus: {
      type: String,
      enum: ["not_applicable", "pending", "paid", "waived"], // not_applicable if no savings
      default: "not_applicable",
    },
    savingsFeePaymentId: {
      type: String,
    },
    savingsFeePaidAt: {
      type: Date,
    },

    // Output
    suppliers: [
      {
        name: String,
        location: String,
        price: Number,
        leadTime: String,
        moq: String,
        notes: String,
        isRecommended: Boolean,
      },
    ],

    // Final Report (What customer sees when report is ready)
    finalReport: {
      supplierDetails: [
        new mongoose.Schema(
          {
            supplierId: {
              type: mongoose.Schema.Types.ObjectId,
              ref: "Supplier",
            },
            supplierName: { type: String },
            location: { type: String },
            contactEmail: { type: String },
            contactPhone: { type: String },
            quoteAmount: { type: Number },
            negotiatedAmount: { type: Number },
            currency: { type: String, default: "USD" },
            leadTime: { type: String },
            minimumOrderQuantity: { type: String },
            notes: { type: String },
            isRecommended: { type: Boolean, default: false },
            uploadedDocuments: [
              {
                name: { type: String }, // Optional user label
                fileName: { type: String }, // Original file name
                type: { type: String }, // MIME type
                url: { type: String }, // Server path
              },
            ],
          },
          { _id: false }
        ),
      ],
      summary: { type: String }, // Overall summary of findings
      recommendations: { type: String }, // Admin's recommendations
      additionalNotes: { type: String }, // Any additional notes
      reportGeneratedAt: { type: Date },
      reportGeneratedBy: {
        type: mongoose.Schema.Types.ObjectId,
        ref: "Admin",
      },
    },
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("ManagedService", ManagedServiceSchema);
