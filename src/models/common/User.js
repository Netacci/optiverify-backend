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
    // H-4: token revocation via version field — bumped on logout / password change
    tokenVersion: {
      type: Number,
      default: 0,
    },
    // H-5: account lockout fields
    failedLoginCount: {
      type: Number,
      default: 0,
    },
    lockedUntil: {
      type: Date,
    },
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

  // M-12: bcrypt cost factor raised from 10 → 12 per OWASP 2024+
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
UserSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * M-12: returns true if the stored bcrypt hash uses fewer rounds than the
 * current target (12). On the next successful login the controller will
 * silently re-hash the user's password by assigning the plaintext, which
 * triggers the pre-save hook above.
 *
 * bcrypt hash format: `$2a$<cost>$<salt+hash>` (also $2b$, $2y$). We parse
 * the cost field defensively and treat any malformed hash as "needs rehash".
 */
UserSchema.methods.needsRehash = function () {
  const TARGET_ROUNDS = 12;
  if (!this.password || typeof this.password !== "string") return false;
  const parts = this.password.split("$");
  // ["", "2a", "10", "<saltAndHash>"]
  if (parts.length < 4) return true;
  const cost = parseInt(parts[2], 10);
  if (Number.isNaN(cost)) return true;
  return cost < TARGET_ROUNDS;
};

export default mongoose.model("User", UserSchema);
