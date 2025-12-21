import dotenv from "dotenv";
dotenv.config();

import { connectDB } from "../config/database.js";
import User from "../models/common/User.js";
import Admin from "../models/admin/Admin.js";

/**
 * Migration script to move admins from User collection to Admin collection
 */
const migrateAdmins = async () => {
  try {
    await connectDB();
    console.log("✅ Connected to MongoDB");

    // Find all users with admin or superAdmin role
    const adminUsers = await User.find({
      role: { $in: ["admin", "superAdmin"] },
    });

    if (adminUsers.length === 0) {
      console.log("ℹ️  No admin users found to migrate");
      process.exit(0);
    }

    console.log(`📋 Found ${adminUsers.length} admin user(s) to migrate`);

    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    for (const user of adminUsers) {
      try {
        // Check if admin already exists
        const existingAdmin = await Admin.findOne({ email: user.email });
        if (existingAdmin) {
          console.log(`⏭️  Skipping ${user.email} - already exists in Admin collection`);
          skipped++;
          continue;
        }

        // Create admin in Admin collection
        const admin = await Admin.create({
          email: user.email,
          password: user.password, // Password is already hashed
          role: user.role,
          isActive: true,
        });

        console.log(`✅ Migrated ${user.email} (${user.role}) to Admin collection`);

        // Optionally, you can remove the role from User or delete the user
        // For now, we'll just remove the role field
        user.role = undefined;
        await user.save();

        migrated++;
      } catch (error) {
        console.error(`❌ Error migrating ${user.email}:`, error.message);
        errors++;
      }
    }

    console.log("\n📊 Migration Summary:");
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped: ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error during migration:", error);
    process.exit(1);
  }
};

migrateAdmins();

