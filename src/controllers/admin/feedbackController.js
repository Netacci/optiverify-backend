import Feedback from "../../models/customer/Feedback.js";

/**
 * Get all feedback (admin only)
 */
export const getAllFeedback = async (req, res) => {
  try {
    const { status, page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const query = {};
    if (status) {
      query.status = status;
    }

    const [feedback, total] = await Promise.all([
      Feedback.find(query)
        .populate("userId", "email")
        .populate("requestId", "category description")
        .populate("matchingServiceId", "category") // Populate managed service if needed
        .populate("transactionId", "amount currency status createdAt") // Populate transaction info
        .populate("replies.adminId", "email")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit)),
      Feedback.countDocuments(query),
    ]);

    res.json({
      success: true,
      data: {
        feedback,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      },
    });
  } catch (error) {
    console.error("Error getting feedback:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Update feedback status (admin only)
 */
export const updateFeedbackStatus = async (req, res) => {
  try {
    const { id } = req.params;
    const { status, adminNotes } = req.body;

    const updateData = {};
    if (status) updateData.status = status;
    if (adminNotes !== undefined) updateData.adminNotes = adminNotes;

    const feedback = await Feedback.findByIdAndUpdate(id, updateData, {
      new: true,
    })
      .populate("userId", "email")
      .populate("requestId", "category description")
      .populate("matchingServiceId", "category")
      .populate("transactionId", "amount currency status createdAt")
      .populate("replies.adminId", "email");

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found",
      });
    }

    res.json({
      success: true,
      message: "Feedback updated successfully",
      data: feedback,
    });
  } catch (error) {
    console.error("Error updating feedback:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Reply to feedback (Admin)
 */
export const replyToFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const admin = req.user;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const feedback = await Feedback.findById(id);

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found",
      });
    }

    feedback.replies.push({
      sender: "admin",
      message,
      adminId: admin._id,
      createdAt: new Date(),
    });

    feedback.status = "replied";
    await feedback.save();

    // Re-populate for response
    await feedback.populate([
      { path: "userId", select: "email" },
      { path: "requestId", select: "category description" },
      { path: "matchingServiceId", select: "category" },
      { path: "transactionId", select: "amount currency status createdAt" },
      { path: "replies.adminId", select: "email" }
    ]);

    res.json({
      success: true,
      message: "Reply sent successfully",
      data: feedback,
    });
  } catch (error) {
    console.error("Error replying to feedback:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};
