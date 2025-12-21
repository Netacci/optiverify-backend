import mongoose from "mongoose";
import dotenv from "dotenv";

dotenv.config();

// Get MONGO_URL from environment, add database name if not present
let MONGO_URL = process.env.MONGO_URL;

// If MONGO_URL doesn't have a database name, add it
if (
  MONGO_URL &&
  !MONGO_URL.includes("/supplyai") &&
  !MONGO_URL.match(/\/[^/]+$/)
) {
  // Add database name to connection string
  MONGO_URL = MONGO_URL.endsWith("/")
    ? `${MONGO_URL}supplyai`
    : `${MONGO_URL}/supplyai`;
}

export const connectDB = async () => {
  try {
    if (!MONGO_URL) {
      throw new Error("MONGO_URL is not defined. Please check your .env file.");
    }

    console.log("🔌 Connecting to MongoDB...");
    await mongoose.connect(MONGO_URL);
    console.log("✅ MongoDB connected successfully");
    console.log(`📍 Database: ${mongoose.connection.name}`);
  } catch (error) {
    console.error("❌ MongoDB connection error:", error);
    console.error("💡 Make sure your MONGO_URL in .env file is correct");
    process.exit(1);
  }
};

// Handle connection events
mongoose.connection.on("disconnected", () => {
  console.log("⚠️ MongoDB disconnected");
});

mongoose.connection.on("error", (err) => {
  console.error("❌ MongoDB error:", err);
});
