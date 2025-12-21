import Feedback from "../../models/customer/Feedback.js";

/**
 * Submit feedback
 */
export const submitFeedback = async (req, res) => {
  try {
    const { type, requestId, matchingServiceId, transactionId, subject, message, rating } = req.body;
    const user = req.user;

    if (!type || !subject || !message) {
      return res.status(400).json({
        success: false,
        message: "Type, subject, and message are required",
      });
    }

    if (type === "request" && !requestId) {
      return res.status(400).json({
        success: false,
        message: "Request ID is required when type is 'request'",
      });
    }

    if (type === "matching_service" && !matchingServiceId) {
      return res.status(400).json({
        success: false,
        message: "Matching Service ID is required when type is 'matching_service'",
      });
    }

    // Optional: Validate transactionId for billing type if strictly required, but usually optional
    // if (type === "billing" && !transactionId) { ... } 

    if (rating && (rating < 1 || rating > 10)) {
      return res.status(400).json({
        success: false,
        message: "Rating must be between 1 and 10",
      });
    }

    const feedback = await Feedback.create({
      userId: user._id,
      email: user.email,
      type,
      requestId: type === "request" ? requestId : undefined,
      matchingServiceId: type === "matching_service" ? matchingServiceId : undefined,
      transactionId: type === "billing" ? transactionId : undefined,
      subject,
      message,
      rating: rating ? parseInt(rating) : undefined,
    });

    res.status(201).json({
      success: true,
      message: "Feedback submitted successfully",
      data: feedback,
    });
  } catch (error) {
    console.error("Error submitting feedback:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

/**
 * Get user's feedback
 */
export const getFeedback = async (req, res) => {
  try {
    const user = req.user;
    const { page = 1, limit = 20 } = req.query;
    const skip = (page - 1) * limit;

    const [feedback, total] = await Promise.all([
      Feedback.find({ userId: user._id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(parseInt(limit))
        .populate("replies.adminId", "email"),
      Feedback.countDocuments({ userId: user._id }),
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
 * Reply to feedback (User)
 */
export const replyToFeedback = async (req, res) => {
  try {
    const { id } = req.params;
    const { message } = req.body;
    const user = req.user;

    if (!message) {
      return res.status(400).json({
        success: false,
        message: "Message is required",
      });
    }

    const feedback = await Feedback.findOne({ _id: id, userId: user._id });

    if (!feedback) {
      return res.status(404).json({
        success: false,
        message: "Feedback not found",
      });
    }

    if (feedback.status === "resolved") {
      return res.status(400).json({
        success: false,
        message: "Cannot reply to resolved feedback",
      });
    }

    feedback.replies.push({
      sender: "user",
      message,
      createdAt: new Date(),
    });

    // Change status to 'new' (or could be a new status 'user_reply') so admin sees it
    feedback.status = "new";
    await feedback.save();

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
