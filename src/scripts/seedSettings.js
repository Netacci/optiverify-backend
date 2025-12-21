import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../config/database.js";
import SystemSettings from "../models/admin/SystemSettings.js";

const seedSettings = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");

    const defaultPricing = {
      key: "pricing_config",
      value: {
        serviceFee: 199,
        savingsFeePercentage: 8,
        currency: "USD",
      },
    };

    // Upsert: Create if doesn't exist, update if it does (but we'll use findOne first to avoid overwriting custom values)
    const existing = await SystemSettings.findOne({ key: "pricing_config" });
    
    if (!existing) {
      await SystemSettings.create(defaultPricing);
      console.log("✅ System settings seeded successfully");
    } else {
      console.log("ℹ️  System settings already exist, skipping seed");
    }

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding settings:", error);
    process.exit(1);
  }
};

seedSettings();

