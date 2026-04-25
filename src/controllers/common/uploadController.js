import path from "path";

/**
 * Upload a single document (PDF or image)
 * Returns the file path that can be served by the frontend
 */
export const uploadDocument = async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        message: "No file provided",
      });
    }

    const { originalname, mimetype, filename } = req.file;

    // Return the file information
    res.json({
      success: true,
      data: {
        fileName: originalname,
        type: mimetype,
        // Path that can be served from the server (Wave 1C: auth-gated route)
        url: `/api/files/${filename}`,
      },
    });
  } catch (error) {
    console.error("Error uploading document:", error);
    res.status(500).json({
      success: false,
      message: "Failed to upload document",
      error: error.message,
    });
  }
};
