import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../config/database.js";
import Admin from "../models/admin/Admin.js";

const createSuperAdmin = async () => {
  try {
    await connectDB();

    const email = process.argv[2];
    const password = process.argv[3];

    if (!email || !password) {
      console.error("Usage: node src/scripts/createSuperAdmin.js <email> <password>");
      process.exit(1);
    }

    // Check if admin already exists
    const existingAdmin = await Admin.findOne({ email: email.toLowerCase().trim() });
    if (existingAdmin) {
      if (existingAdmin.role === "superAdmin") {
        console.log("Admin is already a super admin");
        process.exit(0);
      }
      // Update existing admin to super admin
      existingAdmin.role = "superAdmin";
      existingAdmin.isActive = true;
      if (password) {
        existingAdmin.password = password;
      }
      await existingAdmin.save();
      console.log("Admin updated to super admin successfully!");
    } else {
      // Create new super admin
      const superAdmin = await Admin.create({
        email: email.toLowerCase().trim(),
        password,
        role: "superAdmin",
        isActive: true,
      });
      console.log("Super admin created successfully!");
      console.log("Email:", superAdmin.email);
    }

    process.exit(0);
  } catch (error) {
    console.error("Error creating super admin:", error);
    process.exit(1);
  }
};

createSuperAdmin();

