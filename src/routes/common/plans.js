import express from "express";
import Plan from "../../models/admin/Plan.js";

const router = express.Router();

/**
 * Get active plans for public display (frontend)
 * Excludes extra_credit plans (those are handled separately for top-up)
 */
router.get("/", async (req, res) => {
  try {
    const { includeExtraCredit } = req.query;
    
    const query = { isActive: true };
    
    // By default, exclude extra_credit plans from regular plan listing
    if (includeExtraCredit !== "true") {
      query.planType = { $ne: "extra_credit" };
    }

    const plans = await Plan.find(query).sort({ displayOrder: 1, createdAt: 1 });

    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("Error getting public plans:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

/**
 * Get extra credit plan (for top-up)
 */
router.get("/extra-credit", async (req, res) => {
  try {
    const plan = await Plan.findOne({ 
      planType: "extra_credit",
      isActive: true 
    });

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Extra credit plan not found",
      });
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error("Error getting extra credit plan:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
});

export default router;

