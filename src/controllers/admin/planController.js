import Plan from "../../models/admin/Plan.js";

/**
 * Get all plans
 */
export const getPlans = async (req, res) => {
  try {
    const plans = await Plan.find().sort({ displayOrder: 1, createdAt: 1 });
    res.json({
      success: true,
      data: plans,
    });
  } catch (error) {
    console.error("Error getting plans:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Get single plan by ID
 */
export const getPlanById = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await Plan.findById(id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    res.json({
      success: true,
      data: plan,
    });
  } catch (error) {
    console.error("Error getting plan:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

/**
 * Create a new plan
 */
export const createPlan = async (req, res) => {
  try {
    const {
      name,
      planType,
      description,
      price,
      hasAnnualPricing,
      annualPrice,
      credits,
      features,
      maxRolloverCredits,
      isActive,
      displayOrder,
      isPopular,
    } = req.body;

    // Validate required fields
    if (!name || !planType || price === undefined || credits === undefined) {
      return res.status(400).json({
        success: false,
        message: "Name, plan type, price, and credits are required",
      });
    }

    // Check if planType already exists
    const existingPlan = await Plan.findOne({ planType });
    if (existingPlan) {
      return res.status(400).json({
        success: false,
        message: `Plan with type "${planType}" already exists`,
      });
    }

    // Validate annual pricing
    if (hasAnnualPricing && (!annualPrice || annualPrice <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Annual price is required when annual pricing is enabled",
      });
    }

    const plan = new Plan({
      name,
      planType,
      description,
      price,
      hasAnnualPricing: hasAnnualPricing || false,
      annualPrice: hasAnnualPricing ? annualPrice : undefined,
      credits,
      features: features || [],
      maxRolloverCredits: maxRolloverCredits || 0,
      isActive: isActive !== undefined ? isActive : true,
      displayOrder: displayOrder || 0,
      isPopular: isPopular || false,
      updatedBy: req.admin._id,
    });

    await plan.save();

    res.status(201).json({
      success: true,
      message: "Plan created successfully",
      data: plan,
    });
  } catch (error) {
    console.error("Error creating plan:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update a plan
 */
export const updatePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      description,
      price,
      hasAnnualPricing,
      annualPrice,
      credits,
      features,
      maxRolloverCredits,
      isActive,
      displayOrder,
      isPopular,
    } = req.body;

    const plan = await Plan.findById(id);
    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    // Validate annual pricing
    if (hasAnnualPricing && (!annualPrice || annualPrice <= 0)) {
      return res.status(400).json({
        success: false,
        message: "Annual price is required when annual pricing is enabled",
      });
    }

    // Update fields
    if (name !== undefined) plan.name = name;
    if (description !== undefined) plan.description = description;
    if (price !== undefined) plan.price = price;
    if (hasAnnualPricing !== undefined) plan.hasAnnualPricing = hasAnnualPricing;
    if (annualPrice !== undefined) plan.annualPrice = annualPrice;
    if (credits !== undefined) plan.credits = credits;
    if (features !== undefined) plan.features = features;
    if (maxRolloverCredits !== undefined) plan.maxRolloverCredits = maxRolloverCredits;
    if (isActive !== undefined) plan.isActive = isActive;
    if (displayOrder !== undefined) plan.displayOrder = displayOrder;
    if (isPopular !== undefined) plan.isPopular = isPopular;
    plan.updatedBy = req.admin._id;

    await plan.save();

    res.json({
      success: true,
      message: "Plan updated successfully",
      data: plan,
    });
  } catch (error) {
    console.error("Error updating plan:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Delete a plan
 */
export const deletePlan = async (req, res) => {
  try {
    const { id } = req.params;
    const plan = await Plan.findById(id);

    if (!plan) {
      return res.status(404).json({
        success: false,
        message: "Plan not found",
      });
    }

    // Don't allow deleting plans that are in use (could add validation here)
    // For now, we'll just delete it
    await Plan.findByIdAndDelete(id);

    res.json({
      success: true,
      message: "Plan deleted successfully",
    });
  } catch (error) {
    console.error("Error deleting plan:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

