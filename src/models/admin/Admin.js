import mongoose from "mongoose";
import bcrypt from "bcryptjs";

const AdminSchema = new mongoose.Schema(
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
      required: true,
      minlength: [6, "Password must be at least 6 characters"],
    },
    role: {
      type: String,
      enum: ["admin", "superAdmin"],
      default: "admin",
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    // H-4: token revocation via version field — bumped on logout / password change
    tokenVersion: {
      type: Number,
      default: 0,
    },
    // H-5: account lockout fields (parallel to User; admin login flow lives in
    // adminAuthController.js which is owned by another agent — see report TODO).
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
AdminSchema.pre("save", async function () {
  // Skip if password is not modified
  if (!this.isModified("password")) {
    return;
  }

  // M-12: bcrypt cost factor raised from 10 → 12 per OWASP 2024+
  const salt = await bcrypt.genSalt(12);
  this.password = await bcrypt.hash(this.password, salt);
});

// Compare password method
AdminSchema.methods.comparePassword = async function (candidatePassword) {
  return await bcrypt.compare(candidatePassword, this.password);
};

/**
 * M-12: see User.needsRehash. On a successful admin login the
 * controller should set `admin.password = newPlain; await admin.save();`
 * to trigger silent upgrade.
 */
AdminSchema.methods.needsRehash = function () {
  const TARGET_ROUNDS = 12;
  if (!this.password || typeof this.password !== "string") return false;
  const parts = this.password.split("$");
  if (parts.length < 4) return true;
  const cost = parseInt(parts[2], 10);
  if (Number.isNaN(cost)) return true;
  return cost < TARGET_ROUNDS;
};

export default mongoose.model("Admin", AdminSchema);
