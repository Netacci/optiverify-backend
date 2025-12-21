import SystemSettings from "../../models/admin/SystemSettings.js";

/**
 * Get current system settings (pricing)
 */
export const getSettings = async (req, res) => {
  try {
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

    res.json({
      success: true,
      data: settingsObj,
    });
  } catch (error) {
    console.error("Error getting settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Update system settings
 */
export const updateSettings = async (req, res) => {
  try {
    const {
      savingsFeePercentage,
      extraCreditPrice,
      gradePrices,
      urgencyFees,
    } = req.body;

    const updateData = {
      updatedBy: req.admin._id,
    };

    // Only update fields that are provided
    if (savingsFeePercentage !== undefined)
      updateData.savingsFeePercentage = savingsFeePercentage;
    if (extraCreditPrice !== undefined)
      updateData.extraCreditPrice = extraCreditPrice;

    // Handle gradePrices (convert object to Map)
    if (gradePrices !== undefined) {
      if (typeof gradePrices === "object" && !Array.isArray(gradePrices)) {
        updateData.gradePrices = new Map(Object.entries(gradePrices));
      } else if (gradePrices instanceof Map) {
        updateData.gradePrices = gradePrices;
      }
    }

    // Handle urgencyFees (convert object to Map)
    if (urgencyFees !== undefined) {
      if (typeof urgencyFees === "object" && !Array.isArray(urgencyFees)) {
        updateData.urgencyFees = new Map(Object.entries(urgencyFees));
      } else if (urgencyFees instanceof Map) {
        updateData.urgencyFees = urgencyFees;
      }
    }

    const settings = await SystemSettings.findOneAndUpdate(
      { key: "pricing_config" },
      updateData,
      { new: true, upsert: true }
    );

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

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: settingsObj,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};
