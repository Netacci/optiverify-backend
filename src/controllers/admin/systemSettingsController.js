import SystemSettings from "../../models/admin/SystemSettings.js";

/**
 * Get current system settings (pricing, etc.)
 */
export const getSettings = async (req, res) => {
  try {
    const settings = await SystemSettings.findOne({ key: "pricing_config" });
    
    // Return defaults if not found
    if (!settings) {
      return res.json({
        success: true,
        data: {
          serviceFee: 199,
          savingsFeePercentage: 8,
          currency: "USD",
        },
      });
    }

    res.json({
      success: true,
      data: settings.value,
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
 * Update system settings (Admin only)
 */
export const updateSettings = async (req, res) => {
  try {
    const { serviceFee, savingsFeePercentage } = req.body;

    const settings = await SystemSettings.findOneAndUpdate(
      { key: "pricing_config" },
      {
        $set: {
          "value.serviceFee": serviceFee,
          "value.savingsFeePercentage": savingsFeePercentage,
          updatedBy: req.admin._id,
        },
      },
      { new: true, upsert: true }
    );

    res.json({
      success: true,
      message: "Settings updated successfully",
      data: settings.value,
    });
  } catch (error) {
    console.error("Error updating settings:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

