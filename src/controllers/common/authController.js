import User from "../../models/common/User.js";
import BuyerRequest from "../../models/customer/BuyerRequest.js";
import Payment from "../../models/customer/Payment.js";
import { generateToken } from "../../middleware/auth.js";
import { verifyToken } from "../../services/tokenService.js";
import { sendVerificationEmail } from "../../services/emailService.js";

// Helper to sync payments for a user (blocking)
// Exported for use in emergency session endpoint
export const syncPaymentsForUser = async (user) => {
  try {
    const Payment = (await import("../../models/customer/Payment.js")).default;
    const MatchReport = (await import("../../models/customer/MatchReport.js"))
      .default;
    const Stripe = (await import("stripe")).default;

    const stripeKey = process.env.STRIPE_SECRET_KEY;
    if (!stripeKey || stripeKey.includes("dummy")) {
      return; // Skip if Stripe not configured
    }

    const stripe = new Stripe(stripeKey, { apiVersion: "2024-12-18.acacia" });
    const userEmail = user.email.toLowerCase().trim();

    // Find pending payments
    const pendingPayments = await Payment.find({
      email: {
        $regex: new RegExp(
          `^${userEmail.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
          "i"
        ),
      },
      status: "pending",
    });

    console.log(
      `[sync] Found ${pendingPayments.length} pending payments for ${userEmail}`
    );

    if (pendingPayments.length > 0) {
      let sessions = null;

      for (const payment of pendingPayments) {
        try {
          let updated = false;

          if (payment.stripePaymentIntentId) {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              payment.stripePaymentIntentId
            );
            if (paymentIntent.status === "succeeded") {
              payment.status = "succeeded";
              payment.paidAt = new Date();
              await payment.save();
              updated = true;
            }
          } else if (payment.requestId) {
            // Try to find checkout session
            if (!sessions) {
              console.log(`[sync] Fetching recent Stripe sessions...`);
              const sessionsList = await stripe.checkout.sessions.list({
                limit: 100,
              });
              sessions = sessionsList.data;
              console.log(`[sync] Fetched ${sessions.length} sessions`);
            }

            const matchingSession = sessions.find(
              (s) =>
                s.client_reference_id === payment.requestId.toString() &&
                s.payment_status === "paid"
            );

            if (matchingSession) {
              console.log(
                `[sync] Found matching session ${matchingSession.id} for requestId ${payment.requestId}`
              );
              payment.status = "succeeded";
              payment.stripePaymentIntentId = matchingSession.payment_intent;
              payment.stripeCustomerId = matchingSession.customer;
              payment.stripeSubscriptionId = matchingSession.subscription;
              payment.paidAt = new Date();
              await payment.save();
              updated = true;
            }
          }

          if (updated) {
            // Update subscription if needed
            const isSubscriptionPlan = [
              "starter_monthly",
              "starter_annual",
              "professional_monthly",
              "professional_annual",
            ].includes(payment.planType);

            if (isSubscriptionPlan) {
              user.subscriptionStatus = "active";
              user.subscriptionPlan = payment.planType;
              if (payment.stripeCustomerId)
                user.stripeCustomerId = payment.stripeCustomerId;
              if (payment.stripeSubscriptionId)
                user.stripeSubscriptionId = payment.stripeSubscriptionId;

              // Handle credits with rollover for professional plans
              const Plan = (await import("../../models/admin/Plan.js")).default;

              const getCreditsForPlan = async (planType) => {
                let dbPlanType = planType;
                if (planType.includes("_")) {
                  dbPlanType = planType.split("_")[0];
                }

                const plan = await Plan.findOne({
                  planType: dbPlanType,
                  isActive: true,
                });

                if (plan) {
                  return plan.credits || 0;
                }

                // Fallback to defaults if plan not found
                if (planType === "starter_monthly" || planType === "starter_annual") {
                  return 5;
                }
                if (
                  planType === "professional_monthly" ||
                  planType === "professional_annual"
                ) {
                  return 15;
                }
                return 0;
              };
              const getMaxRolloverCredits = async (planType) => {
                const Plan = (await import("../../models/admin/Plan.js")).default;
                
                let dbPlanType = planType;
                if (planType.includes("_")) {
                  dbPlanType = planType.split("_")[0];
                }

                const plan = await Plan.findOne({ 
                  planType: dbPlanType,
                  isActive: true 
                });

                if (plan) {
                  return plan.maxRolloverCredits || 0;
                }

                // Fallback
                if (
                  planType === "professional_monthly" ||
                  planType === "professional_annual"
                )
                  return 3;
                return 0;
              };

              const creditsForPlan = await getCreditsForPlan(payment.planType);
              const maxRollover = await getMaxRolloverCredits(payment.planType);
              const currentCredits = user.matchCredits || 0;

              if (maxRollover > 0 && currentCredits > 0) {
                const rolloverCredits = Math.min(currentCredits, maxRollover);
                user.matchCredits = creditsForPlan + rolloverCredits;
              } else {
                user.matchCredits = creditsForPlan;
              }

              const now = new Date();
              if (
                payment.planType === "starter_monthly" ||
                payment.planType === "professional_monthly"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setMonth(expiryDate.getMonth() + 1);
                user.subscriptionExpiresAt = expiryDate;
              } else if (
                payment.planType === "starter_annual" ||
                payment.planType === "professional_annual"
              ) {
                const expiryDate = new Date(now);
                expiryDate.setFullYear(expiryDate.getFullYear() + 1);
                user.subscriptionExpiresAt = expiryDate;
              }
              await user.save();
              console.log(
                `[sync] Updated user subscription to ${payment.planType}`
              );
            }

            // Unlock match report if exists
            if (payment.matchReportId) {
              const matchReport = await MatchReport.findById(
                payment.matchReportId
              );
              if (matchReport && matchReport.status !== "unlocked") {
                matchReport.status = "unlocked";
                matchReport.paymentId = payment._id.toString();
                matchReport.unlockedAt = new Date();
                await matchReport.save();
                console.log(
                  `[sync] Unlocked match report ${payment.matchReportId}`
                );
              }
            }

            // Update Managed Service if exists
            if (payment.planType === "managed_service" && payment.requestId) {
              const ManagedService = (
                await import("../../models/customer/ManagedService.js")
              ).default;
              const managedService = await ManagedService.findById(
                payment.requestId
              );
              if (
                managedService &&
                managedService.serviceFeeStatus !== "paid"
              ) {
                managedService.serviceFeeStatus = "paid";
                managedService.serviceFeePaymentId =
                  payment.stripePaymentIntentId;
                managedService.serviceFeePaidAt = new Date();
                // Set to 'submitted' instead of 'review' as per user request
                managedService.status = "in_progress";
                managedService.stage = "submitted";
                await managedService.save();
                console.log(
                  `[sync] Updated managed service ${payment.requestId} status to submitted`
                );
              }
            }
          }
        } catch (syncError) {
          console.error(
            `[sync] Error syncing payment ${payment._id}:`,
            syncError
          );
        }
      }
    }
  } catch (error) {
    console.error("[sync] Error in payment sync:", error);
  }
};

/**
 * Verify email token and create account (or verify existing)
 */
export const verifyEmail = async (req, res) => {
  try {
    const { token, email } = req.query;

    if (!token || !email) {
      return res.status(400).json({
        success: false,
        message: "Token and email are required",
      });
    }

    // Verify token
    const verification = verifyToken(token, email, null, "verification");
    console.log(
      `[Auth Verification] Valid: ${verification.valid}, Email: ${email}`
    );
    if (!verification.valid) {
      console.error(
        `[Auth Verification] Token verification failed for email ${email}:`,
        verification.error
      );
      return res.status(400).json({
        success: false,
        message: verification.error || "Invalid or expired verification link",
      });
    }

    // Check if user already exists
    let user = await User.findOne({ email: email.toLowerCase().trim() });

    if (user) {
      // User exists - just verify email
      if (user.isVerified) {
        return res.json({
          success: true,
          message: "Email already verified",
          data: {
            email: user.email,
            isNewUser: false,
            redirectUrl: `${
              process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
            }/login`,
          },
        });
      }

      user.isVerified = true;
      user.verificationToken = undefined;
      user.verificationTokenExpiry = undefined;
      await user.save();

      // Check if user has password - if yes, go to login; if no, create password
      const hasPassword = !!user.password;

      return res.json({
        success: true,
        message: "Email verified successfully",
        data: {
          email: user.email,
          isNewUser: false,
          hasPassword,
          redirectUrl: hasPassword
            ? `${
                process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
              }/login`
            : `${
                process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
              }/create-password?token=${token}&email=${encodeURIComponent(
                email
              )}`,
        },
      });
    }

    // New user - create account (without password yet)
    user = new User({
      email: email.toLowerCase().trim(),
      isVerified: true,
      verificationToken: undefined,
      verificationTokenExpiry: undefined,
    });
    await user.save();

    return res.json({
      success: true,
      message: "Email verified. Please create your password.",
      data: {
        email: user.email,
        isNewUser: true,
        redirectUrl: `${
          process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"
        }/create-password?token=${token}&email=${encodeURIComponent(email)}`,
      },
    });
  } catch (error) {
    console.error("Error verifying email:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Create password for verified user
 */
export const createPassword = async (req, res) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Token, email, and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Verify token
    const verification = verifyToken(token, email, null, "verification");
    if (!verification.valid) {
      console.error(
        `[Auth Verification] Token verification failed for email ${email}:`,
        verification.error
      );
      return res.status(400).json({
        success: false,
        message: verification.error || "Invalid or expired verification link",
      });
    }

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      // Create user if doesn't exist (for managed services where webhook might have failed)
      user = new User({
        email: email.toLowerCase().trim(),
        isVerified: true, // Mark as verified since token is valid
      });
      await user.save();
    }

    // If user exists but not verified, verify them now (token verification is sufficient)
    if (!user.isVerified) {
      user.isVerified = true;
      await user.save();
    }

    // Link any managed services that match this email but don't have userId set
    try {
      const ManagedService = (
        await import("../../models/customer/ManagedService.js")
      ).default;
      const userEmailLower = email.toLowerCase().trim();
      const result = await ManagedService.updateMany(
        {
          email: { $regex: new RegExp(`^${userEmailLower}$`, "i") },
          $or: [
            { userId: { $exists: false } },
            { userId: null },
            { userId: { $ne: user._id } },
          ],
        },
        {
          $set: { userId: user._id },
        }
      );
      console.log(
        `Linked ${result.modifiedCount} managed service(s) to user ${user._id} during password creation`
      );
    } catch (linkError) {
      console.error("Error linking managed services to user:", linkError);
      // Don't fail password creation if linking fails
    }

    // Link any payments that match this email but don't have a user linked
    // Also check if there are subscription payments that need to be applied to this user
    try {
      const Payment = (await import("../../models/customer/Payment.js"))
        .default;
      const userEmailLower = email.toLowerCase().trim();

      // Sync payments first to ensure statuses are up to date
      await syncPaymentsForUser(user);

      // Find payments for this email that are subscription payments (monthly/annual)
      const subscriptionPayments = await Payment.find({
        email: {
          $regex: new RegExp(
            `^${userEmailLower.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`,
            "i"
          ),
        },
        planType: { $in: ["monthly", "annual"] },
        status: "succeeded",
      }).sort({ createdAt: -1 });

      // If we have subscription payments and user doesn't have an active subscription, apply the latest one
      const hasActiveSubscription =
        user.subscriptionStatus === "active" &&
        user.subscriptionExpiresAt &&
        new Date(user.subscriptionExpiresAt) > new Date();

      if (subscriptionPayments.length > 0 && !hasActiveSubscription) {
        const latestPayment = subscriptionPayments[0];
        console.log(
          `[createPassword] Found subscription payment ${latestPayment._id} for user ${user._id}, applying subscription`
        );

        user.subscriptionStatus = "active";
        user.subscriptionPlan = latestPayment.planType;
        if (latestPayment.stripeCustomerId) {
          user.stripeCustomerId = latestPayment.stripeCustomerId;
        }

        // Handle credits with rollover for professional plans
        const Plan = (await import("../../models/admin/Plan.js")).default;

        const getCreditsForPlan = async (planType) => {
          let dbPlanType = planType;
          if (planType.includes("_")) {
            dbPlanType = planType.split("_")[0];
          }

          const plan = await Plan.findOne({
            planType: dbPlanType,
            isActive: true,
          });

          if (plan) {
            return plan.credits || 0;
          }

          // Fallback to defaults if plan not found
          if (planType === "starter_monthly" || planType === "starter_annual") {
            return 5;
          }
          if (
            planType === "professional_monthly" ||
            planType === "professional_annual"
          ) {
            return 15;
          }
          return 0;
        };
        const getMaxRolloverCredits = async (planType) => {
          const Plan = (await import("../../models/admin/Plan.js")).default;
          
          let dbPlanType = planType;
          if (planType.includes("_")) {
            dbPlanType = planType.split("_")[0];
          }

          const plan = await Plan.findOne({
            planType: dbPlanType,
            isActive: true,
          });

          if (plan) {
            return plan.maxRolloverCredits || 0;
          }

          // Fallback
          if (
            planType === "professional_monthly" ||
            planType === "professional_annual"
          ) {
            return 3;
          }
          return 0;
        };

        const creditsForPlan = await getCreditsForPlan(latestPayment.planType);
        const maxRollover = await getMaxRolloverCredits(latestPayment.planType);
        const currentCredits = user.matchCredits || 0;

        if (maxRollover > 0 && currentCredits > 0) {
          const rolloverCredits = Math.min(currentCredits, maxRollover);
          user.matchCredits = creditsForPlan + rolloverCredits;
        } else {
          user.matchCredits = creditsForPlan;
        }

        // Set expiry date based on plan type (create new Date to avoid mutation)
        const now = new Date();
        if (
          latestPayment.planType === "starter_monthly" ||
          latestPayment.planType === "professional_monthly"
        ) {
          const expiryDate = new Date(now);
          expiryDate.setMonth(expiryDate.getMonth() + 1);
          user.subscriptionExpiresAt = expiryDate;
        } else if (
          latestPayment.planType === "starter_annual" ||
          latestPayment.planType === "professional_annual"
        ) {
          const expiryDate = new Date(now);
          expiryDate.setFullYear(expiryDate.getFullYear() + 1);
          user.subscriptionExpiresAt = expiryDate;
        }

        await user.save();
        console.log(
          `[createPassword] Applied subscription ${latestPayment.planType} to user ${user._id}, expires at ${user.subscriptionExpiresAt}`
        );
      } else if (hasActiveSubscription) {
        console.log(
          `[createPassword] User ${user._id} already has active subscription ${user.subscriptionPlan}`
        );
      }
    } catch (paymentLinkError) {
      console.error(
        "Error linking payments/subscriptions to user:",
        paymentLinkError
      );
      // Don't fail password creation if linking fails
    }

    // Set password
    user.password = password;
    await user.save();

    // Generate JWT token
    const jwtToken = generateToken(user._id.toString());

    // Set cookie (customer token)
    res.cookie("cd-token", jwtToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      success: true,
      message: "Password created successfully",
      data: {
        user: {
          id: user._id,
          email: user.email,
        },
        token: jwtToken,
      },
    });
  } catch (error) {
    console.error("Error creating password:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Login user
 */
export const login = async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        success: false,
        message: "Email and password are required",
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    if (!user.isVerified) {
      return res.status(401).json({
        success: false,
        message: "Please verify your email first",
      });
    }

    if (!user.password) {
      return res.status(401).json({
        success: false,
        message: "Please create a password first",
      });
    }

    // Check password
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({
        success: false,
        message: "Invalid email or password",
      });
    }

    // Automatically sync payments (BLOCKING)
    // This ensures subscriptions and payments are up-to-date BEFORE sending response
    await syncPaymentsForUser(user);

    // Generate JWT token
    const token = generateToken(user._id.toString());

    // Set cookie
    res.cookie("token", token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
    });

    res.json({
      success: true,
      message: "Login successful",
      data: {
        token,
        user: {
          id: user._id,
          email: user.email,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionPlan: user.subscriptionPlan,
        },
      },
    });
  } catch (error) {
    console.error("Error logging in:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Logout user
 */
export const logout = async (req, res) => {
  res.clearCookie("cd-token");
  res.json({
    success: true,
    message: "Logged out successfully",
  });
};

/**
 * Get current user
 */
export const getCurrentUser = async (req, res) => {
  try {
    const user = await User.findById(req.user._id)
      .select("-password")
      .populate("requests");

    res.json({
      success: true,
      data: {
        user: {
          id: user._id,
          email: user.email,
          isVerified: user.isVerified,
          subscriptionStatus: user.subscriptionStatus,
          subscriptionPlan: user.subscriptionPlan,
          subscriptionExpiresAt: user.subscriptionExpiresAt,
          matchCredits: user.matchCredits || 0, // Add matchCredits here
          requests: user.requests,
        },
      },
    });
  } catch (error) {
    console.error("Error getting current user:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Resend verification email
 */
export const resendVerification = async (req, res) => {
  console.log("resendVerification called with body:", req.body);
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    const userEmail = email.toLowerCase().trim();

    // Check if user exists
    const user = await User.findOne({ email: userEmail });
    if (user && user.isVerified) {
      return res.status(400).json({
        success: false,
        message: "Email is already verified. Please log in.",
      });
    }

    // Find latest activity to determine context
    const ManagedService = (
      await import("../../models/customer/ManagedService.js")
    ).default;
    const Payment = (await import("../../models/customer/Payment.js")).default;
    const { generateToken: generateTokenService } = await import(
      "../../services/tokenService.js"
    );
    const { sendPaymentAndVerificationEmail, sendVerificationEmail } =
      await import("../../services/emailService.js");

    // Check for managed service
    const managedService = await ManagedService.findOne({
      email: userEmail,
      status: { $in: ["pending_payment", "submitted", "in_progress"] },
    }).sort({ createdAt: -1 });

    // Check for payment
    const payment = await Payment.findOne({
      email: userEmail,
      status: "succeeded",
    }).sort({ createdAt: -1 });

    let requestId = managedService?._id || payment?.requestId;
    let planType = payment?.planType || "managed_service";

    // Generate token
    const token = generateTokenService(
      userEmail,
      requestId ? requestId.toString() : "general",
      "verification"
    );

    // Send email
    if (
      payment ||
      (managedService && managedService.serviceFeeStatus === "paid")
    ) {
      // If they paid, send the nice payment confirmation + verify email
      await sendPaymentAndVerificationEmail({
        email: userEmail,
        requestId: requestId ? requestId.toString() : "general",
        planType: planType,
        verificationToken: token,
      });
    } else {
      // Standard verification
      await sendVerificationEmail({
        email: userEmail,
        requestId: requestId ? requestId.toString() : "general",
        token: token,
        isNewRequest: true,
      });
    }

    res.json({
      success: true,
      message: "Verification email sent",
    });
  } catch (error) {
    console.error("Error resending verification:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Request password reset
 */
export const forgotPassword = async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({
        success: false,
        message: "Email is required",
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });

    // Always return success to prevent email enumeration
    if (!user) {
      return res.json({
        success: true,
        message:
          "If an account exists with this email, a password reset link has been sent",
      });
    }

    // Check if user has a password (if not, they should use create password flow)
    if (!user.password) {
      return res.json({
        success: true,
        message:
          "If an account exists with this email, a password reset link has been sent",
      });
    }

    // Generate reset token
    const { generateToken: generateTokenService } = await import(
      "../../services/tokenService.js"
    );
    const resetToken = generateTokenService(
      email.toLowerCase().trim(),
      null,
      "passwordReset"
    );

    // Send reset email
    const { sendPasswordResetEmail } = await import(
      "../../services/emailService.js"
    );
    await sendPasswordResetEmail({
      email: user.email,
      resetToken,
    });

    res.json({
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent",
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    // Still return success to prevent email enumeration
    res.json({
      success: true,
      message:
        "If an account exists with this email, a password reset link has been sent",
    });
  }
};

/**
 * Reset password using token
 */
export const resetPassword = async (req, res) => {
  try {
    const { token, email, password } = req.body;

    if (!token || !email || !password) {
      return res.status(400).json({
        success: false,
        message: "Token, email, and password are required",
      });
    }

    if (password.length < 6) {
      return res.status(400).json({
        success: false,
        message: "Password must be at least 6 characters",
      });
    }

    // Verify token
    const verification = verifyToken(token, email, null, "passwordReset");
    if (!verification.valid) {
      return res.status(400).json({
        success: false,
        message: verification.error || "Invalid or expired reset link",
      });
    }

    // Find user
    const user = await User.findOne({ email: email.toLowerCase().trim() });
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Update password (will be hashed by pre-save hook)
    user.password = password;
    await user.save();

    res.json({
      success: true,
      message: "Password reset successfully",
    });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Emergency session sync endpoint
 * Syncs all pending payments and subscriptions for the authenticated user
 */
export const emergencySessionSync = async (req, res) => {
  try {
    const user = await User.findById(req.user._id);
    
    if (!user) {
      return res.status(404).json({
        success: false,
        message: "User not found",
      });
    }

    // Use the syncPaymentsForUser function
    await syncPaymentsForUser(user);

    // Refresh user data after sync
    const updatedUser = await User.findById(user._id);

    res.json({
      success: true,
      message: "Session synced successfully",
      data: {
        user: {
          _id: updatedUser._id,
          email: updatedUser.email,
          subscriptionStatus: updatedUser.subscriptionStatus,
          subscriptionPlan: updatedUser.subscriptionPlan,
          matchCredits: updatedUser.matchCredits,
          subscriptionExpiresAt: updatedUser.subscriptionExpiresAt,
        },
      },
    });
  } catch (error) {
    console.error("Error in emergency session sync:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
