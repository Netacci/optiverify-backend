import mongoose from "mongoose";
import dotenv from "dotenv";
import Plan from "../models/admin/Plan.js";

dotenv.config();

const seedPlans = async () => {
  try {
    await mongoose.connect(process.env.MONGODB_URI);

    console.log("🌱 Seeding plans...");

    const plans = [
      {
        name: "BASIC",
        planType: "basic",
        description: "Best for small teams or one-time sourcing needs",
        price: 49,
        hasAnnualPricing: false,
        credits: 1,
        features: [
          "Full Match Report for 1 request",
          "Supplier names & contact details",
          "MOQs & Lead times",
          "Verification badges",
          "Risk assessment",
          "Negotiation tips",
          "Downloadable report (PDF)",
          "Email support",
        ],
        isActive: true,
        displayOrder: 1,
        isPopular: false,
      },
      {
        name: "STARTER",
        planType: "starter",
        description: "For owners & lean teams",
        price: 79,
        hasAnnualPricing: true,
        annualPrice: 869,
        credits: 5,
        features: [
          "Everything in BASIC",
          "5 full matches per month",
          "Priority matching",
          "Faster processing time",
          "Discounted extra matches ($10)",
          "Email support",
          "Top up credit anytime",
        ],
        isActive: true,
        displayOrder: 2,
        isPopular: true,
      },
      {
        name: "PROFESSIONAL",
        planType: "professional",
        description: "For procurement-led organizations",
        price: 199,
        hasAnnualPricing: true,
        annualPrice: 2189,
        credits: 15,
        maxRolloverCredits: 3,
        features: [
          "Everything in STARTER",
          "15 full matches per month",
          "Up to 3 credits rollover",
          "Priority matching",
          "Faster processing time",
          "Discounted extra matches ($10)",
          "Email support",
          "Top up credit anytime",
        ],
        isActive: true,
        displayOrder: 3,
        isPopular: false,
      },
    ];

    for (const planData of plans) {
      const existingPlan = await Plan.findOne({ planType: planData.planType });
      if (existingPlan) {
        console.log(
          `⚠️  Plan ${planData.planType} already exists, skipping...`
        );
        continue;
      }

      const plan = new Plan(planData);
      await plan.save();
      console.log(`✅ Created plan: ${planData.name} (${planData.planType})`);
    }

    console.log("✨ Plans seeding completed!");
    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding plans:", error);
    process.exit(1);
  }
};

seedPlans();
