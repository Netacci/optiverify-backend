import express from "express";
import { getSettings } from "../../controllers/admin/settingsController.js";

const router = express.Router();

// Public endpoint to get system settings (for pricing display on forms)
// GET /api/settings/public - Get public system settings
router.get("/public", async (req, res) => {
  try {
    const SystemSettings = (
      await import("../../models/admin/SystemSettings.js")
    ).default;
    let settings = await SystemSettings.findOne({ key: "pricing_config" });

    // Initialize defaults if not exists
    if (!settings) {
      settings = await SystemSettings.create({
        key: "pricing_config",
        savingsFeePercentage: 8,
        extraCreditPrice: 10,
        gradePrices: new Map([
          ["low", 750],
          ["medium", 1500],
          ["high", 2500],
        ]),
        urgencyFees: new Map([
          ["standard", { fee: 0, duration: "5-7 days" }],
          ["expedited", { fee: 500, duration: "2-3 days" }],
          ["emergency", { fee: 1000, duration: "24-48 hrs" }],
        ]),
      });
    }

    // Convert Maps to objects for JSON response
    const settingsObj = settings.toObject();
    if (settings.gradePrices instanceof Map) {
      settingsObj.gradePrices = Object.fromEntries(settings.gradePrices);
    }
    if (settings.urgencyFees instanceof Map) {
      // Convert urgency fees Map to object, preserving structure
      const urgencyFeesObj = {};
      for (const [key, value] of settings.urgencyFees.entries()) {
        urgencyFeesObj[key] = value;
      }
      settingsObj.urgencyFees = urgencyFeesObj;
    }

    // Return only public fields (managed sourcing pricing and extra credit)
    res.json({
      success: true,
      data: {
        savingsFeePercentage: settingsObj.savingsFeePercentage || 8,
        extraCreditPrice: settingsObj.extraCreditPrice || 10,
        currency: settingsObj.currency || "USD",
        gradePrices: settingsObj.gradePrices || {
          low: 750,
          medium: 1500,
          high: 2500,
        },
        urgencyFees: settingsObj.urgencyFees || {
          standard: { fee: 0, duration: "5-7 days" },
          expedited: { fee: 500, duration: "2-3 days" },
          emergency: { fee: 1000, duration: "24-48 hrs" },
        },
      },
    });
  } catch (error) {
    console.error("Error getting public settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;
