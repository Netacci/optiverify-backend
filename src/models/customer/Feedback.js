import mongoose from "mongoose";

const FeedbackSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    email: {
      type: String,
      required: true,
      trim: true,
    },
    subject: {
      type: String,
      required: true,
      trim: true,
    },
    message: {
      type: String,
      required: true,
    },
    type: {
      type: String,
      enum: ["request", "matching_service", "general", "billing"],
      required: true,
    },
    requestId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "BuyerRequest",
    },
    matchingServiceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ManagedService", // Explicit reference
    },
    transactionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Payment", // Assuming transactions are payments
    },
    rating: {
      type: Number,
      min: 1,
      max: 10,
    },
    status: {
      type: String,
      enum: ["new", "read", "replied", "resolved"],
      default: "new",
    },
    adminNotes: {
      type: String,
      trim: true,
    },
    replies: [
      {
        sender: {
          type: String,
          enum: ["user", "admin"],
          required: true,
        },
        message: {
          type: String,
          required: true,
        },
        adminId: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Admin",
        },
        createdAt: {
          type: Date,
          default: Date.now,
        },
      },
    ],
  },
  {
    timestamps: true,
  }
);

export default mongoose.model("Feedback", FeedbackSchema);
