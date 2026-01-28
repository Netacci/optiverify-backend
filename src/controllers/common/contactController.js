import { sendContactEmail } from "../../services/emailService.js";

/**
 * Submit contact form
 */
export const submitContact = async (req, res) => {
  try {
    const { name, email, company, role, message } = req.body;

    // Validate required fields
    if (!name || !email || !message) {
      return res.status(400).json({
        success: false,
        message: "Name, email, and message are required",
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      return res.status(400).json({
        success: false,
        message: "Invalid email format",
      });
    }

    // Send email to support
    await sendContactEmail({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      company: company ? company.trim() : "",
      role: role || "",
      message: message.trim(),
    });

    res.json({
      success: true,
      message: "Thank you for your message! We will get back to you soon.",
    });
  } catch (error) {
    console.error("Error submitting contact form:", error);
    res.status(500).json({
      success: false,
      message: "Failed to send message. Please try again later.",
    });
  }
};
