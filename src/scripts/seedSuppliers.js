import dotenv from "dotenv";
import { connectDB } from "../config/database.js";
import Supplier from "../models/admin/Supplier.js";

dotenv.config();

const dummySuppliers = [
  // Electronics Suppliers
  {
    name: "Global Electronics Manufacturing Co.",
    category: "Electronics",
    description: "Leading manufacturer of PCB assembly, electronic components, and consumer electronics. ISO 9001 certified with 20+ years of experience.",
    location: "Shenzhen, China",
    email: "contact@globalelectronics.com",
    phone: "+86-755-1234-5678",
    website: "https://globalelectronics.com",
    certifications: ["ISO 9001", "RoHS", "CE", "FCC"],
    minOrderQuantity: "500 units",
    leadTime: "4-6 weeks",
    capabilities: ["PCB Assembly", "Component Sourcing", "Quality Control", "Custom Design"],
    keywords: ["electronics", "pcb", "assembly", "components", "manufacturing"],
    isActive: true,
  },
  {
    name: "TechSource International",
    category: "Electronics",
    description: "Specialized in high-volume electronics manufacturing and supply chain management. Serves Fortune 500 companies worldwide.",
    location: "Guangzhou, China",
    email: "sales@techsource.com",
    phone: "+86-20-9876-5432",
    website: "https://techsource.com",
    certifications: ["ISO 9001", "ISO 14001", "UL", "IEC"],
    minOrderQuantity: "1000 units",
    leadTime: "6-8 weeks",
    capabilities: ["Mass Production", "Supply Chain", "Logistics", "Quality Assurance"],
    keywords: ["electronics", "manufacturing", "supply chain", "mass production"],
    isActive: true,
  },
  {
    name: "Precision Electronics Ltd",
    category: "Electronics",
    description: "Premium electronics manufacturer focusing on precision components and custom solutions for specialized industries.",
    location: "Shanghai, China",
    email: "info@precisionelec.com",
    phone: "+86-21-5555-1234",
    website: "https://precisionelec.com",
    certifications: ["ISO 9001", "AS9100", "IPC-A-610"],
    minOrderQuantity: "100 units",
    leadTime: "3-5 weeks",
    capabilities: ["Precision Manufacturing", "Custom Solutions", "Prototyping", "Testing"],
    keywords: ["electronics", "precision", "custom", "prototyping"],
    isActive: true,
  },
  // Textiles Suppliers
  {
    name: "Textile Masters Global",
    category: "Textiles",
    description: "Large-scale textile manufacturer specializing in cotton, polyester, and blended fabrics. Export to 50+ countries.",
    location: "Dhaka, Bangladesh",
    email: "sales@textilemasters.com",
    phone: "+880-2-1234-5678",
    website: "https://textilemasters.com",
    certifications: ["OEKO-TEX", "GOTS", "WRAP", "BSCI"],
    minOrderQuantity: "1000 yards",
    leadTime: "5-7 weeks",
    capabilities: ["Fabric Manufacturing", "Dyeing", "Printing", "Finishing"],
    keywords: ["textiles", "fabric", "cotton", "polyester", "manufacturing"],
    isActive: true,
  },
  {
    name: "Premium Textile Solutions",
    category: "Textiles",
    description: "High-quality textile supplier focusing on sustainable and organic materials. Specializes in eco-friendly production.",
    location: "Istanbul, Turkey",
    email: "contact@premiumtextile.com",
    phone: "+90-212-9876-5432",
    website: "https://premiumtextile.com",
    certifications: ["GOTS", "OEKO-TEX", "ISO 14001"],
    minOrderQuantity: "500 yards",
    leadTime: "4-6 weeks",
    capabilities: ["Organic Textiles", "Sustainable Manufacturing", "Custom Dyeing", "Quality Control"],
    keywords: ["textiles", "organic", "sustainable", "eco-friendly"],
    isActive: true,
  },
  // Machinery Suppliers
  {
    name: "Industrial Machinery Works",
    category: "Machinery",
    description: "Manufacturer of industrial machinery, equipment, and automation systems. Serving manufacturing industries globally.",
    location: "Dongguan, China",
    email: "sales@indmachinery.com",
    phone: "+86-769-1111-2222",
    website: "https://indmachinery.com",
    certifications: ["ISO 9001", "CE", "ISO 14001"],
    minOrderQuantity: "1 unit",
    leadTime: "8-12 weeks",
    capabilities: ["Custom Machinery", "Automation", "Installation", "Training"],
    keywords: ["machinery", "industrial", "automation", "equipment"],
    isActive: true,
  },
  {
    name: "Precision Machine Tools Inc",
    category: "Machinery",
    description: "Specialized in precision machine tools, CNC equipment, and manufacturing solutions for aerospace and automotive industries.",
    location: "Taipei, Taiwan",
    email: "info@precisiontools.com",
    phone: "+886-2-3333-4444",
    website: "https://precisiontools.com",
    certifications: ["ISO 9001", "AS9100", "ISO 14001"],
    minOrderQuantity: "1 unit",
    leadTime: "10-14 weeks",
    capabilities: ["CNC Machines", "Precision Tools", "Custom Solutions", "Technical Support"],
    keywords: ["machinery", "cnc", "precision", "tools", "aerospace"],
    isActive: true,
  },
  // Food & Beverage Suppliers
  {
    name: "Global Food Products Ltd",
    category: "Food & Beverage",
    description: "Large-scale food manufacturer specializing in packaged foods, beverages, and food ingredients. HACCP certified.",
    location: "Mumbai, India",
    email: "sales@globalfood.com",
    phone: "+91-22-5555-6666",
    website: "https://globalfood.com",
    certifications: ["HACCP", "ISO 22000", "FDA", "FSSAI"],
    minOrderQuantity: "1000 units",
    leadTime: "3-4 weeks",
    capabilities: ["Food Manufacturing", "Packaging", "Quality Control", "Export"],
    keywords: ["food", "beverage", "packaged", "ingredients"],
    isActive: true,
  },
  {
    name: "Organic Harvest Co",
    category: "Food & Beverage",
    description: "Premium organic food supplier focusing on natural and organic products. Certified organic and fair trade.",
    location: "California, USA",
    email: "info@organicharvest.com",
    phone: "+1-415-777-8888",
    website: "https://organicharvest.com",
    certifications: ["USDA Organic", "Fair Trade", "Non-GMO", "Kosher"],
    minOrderQuantity: "500 units",
    leadTime: "2-3 weeks",
    capabilities: ["Organic Products", "Natural Foods", "Custom Packaging", "Distribution"],
    keywords: ["food", "organic", "natural", "fair trade"],
    isActive: true,
  },
  // Note: Furniture suppliers removed - use this category to test "No matching suppliers found"
];

const seedSuppliers = async () => {
  try {
    // Use the same database connection as the app
    await connectDB();
    console.log("✅ Connected to MongoDB");

    // Clear existing suppliers in the supplyai database
    await Supplier.deleteMany({});
    console.log("🗑️  Cleared existing suppliers");

    // Insert dummy suppliers
    await Supplier.insertMany(dummySuppliers);
    console.log(`✅ Seeded ${dummySuppliers.length} suppliers successfully`);

    process.exit(0);
  } catch (error) {
    console.error("❌ Error seeding suppliers:", error);
    process.exit(1);
  }
};

seedSuppliers();

