import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const UserSchema = new mongoose.Schema(
  {
    email: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      match: [
        /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
        "Please provide a valid email address",
      ],
    },
    password: {
      type: String,
      required: function () {
        // Only require password if user is verified AND password is being set/modified
        // This allows creating users without passwords initially (they'll set it later)
        return this.isVerified && this.isModified("password");
      },
      minlength: [6, "Password must be at least 6 characters"],
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
    verificationToken: {
      type: String,
    },
    verificationTokenExpiry: {
      type: Date,
    },
    subscriptionStatus: {
      type: String,
      enum: ["none", "active", "expired", "canceled"],
      default: "none",
    },
    subscriptionPlan: {
      type: String,
      enum: [
        "one-time",
        "starter_monthly",
        "starter_annual",
        "professional_monthly",
        "professional_annual",
        null,
      ],
      default: null,
    },
    subscriptionExpiresAt: {
      type: Date,
    },
    stripeCustomerId: {
      type: String,
      trim: true,
    },
    stripeSubscriptionId: {
      type: String,
      trim: true,
    },
    matchCredits: {
      type: Number,
      default: 0,
    },
    requests: [
      {
        type: mongoose.Schema.Types.ObjectId,
        ref: "BuyerRequest",
      },
    ],
  },
  {
    timestamps: true,
  }
);

// Hash password before saving
UserSchema.pre("save", async function () {
  // Skip if password is not modified or doesn't exist
  if (!this.isModified("password") || !this.password) {
    return;
  }

  // Hash password
  const salt = await bcrypt.genSalt(10);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

export default mongoose.model("User", UserSchema);
