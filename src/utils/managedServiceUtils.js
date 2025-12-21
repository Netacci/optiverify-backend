import SystemSettings from "../models/admin/SystemSettings.js";

/**
 * Calculate days left for a managed service based on urgency and created date
 * @param {string} urgency - The urgency level (e.g., "standard", "expedited", "emergency")
 * @param {Date} createdAt - The date when the service was created
 * @param {Object} settings - SystemSettings object (optional, will fetch if not provided)
 * @returns {Object} - { daysLeft: number, deadline: Date, urgencyDuration: string }
 */
export const calculateDaysLeft = async (urgency, createdAt, settings = null) => {
  try {
    // Fetch settings if not provided
    if (!settings) {
      settings = await SystemSettings.findOne({ key: "pricing_config" });
    }

    // Get urgency fees with duration
    let urgencyFees = {
      standard: { fee: 0, duration: "5-7 days" },
      expedited: { fee: 500, duration: "2-3 days" },
      emergency: { fee: 1000, duration: "24-48 hrs" },
    };

    if (settings?.urgencyFees) {
      if (settings.urgencyFees instanceof Map) {
        urgencyFees = Object.fromEntries(settings.urgencyFees);
      } else {
        urgencyFees = settings.urgencyFees;
      }
    }

    // Get urgency data
    const urgencyData = urgencyFees[urgency] || urgencyFees.standard;
    const duration = typeof urgencyData === 'object' ? urgencyData.duration : "";

    // Parse duration to get max days
    let maxDays = 7; // Default
    if (duration) {
      // Parse formats like "5-7 days", "2-3 days", "24-48 hrs"
      const match = duration.match(/(\d+)\s*-\s*(\d+)/);
      if (match) {
        maxDays = parseInt(match[2]); // Use the higher number
      } else {
        // Handle "24-48 hrs" - convert to days
        const hrsMatch = duration.match(/(\d+)\s*-\s*(\d+)\s*hrs?/i);
        if (hrsMatch) {
          const maxHrs = parseInt(hrsMatch[2]);
          maxDays = Math.ceil(maxHrs / 24); // Convert hours to days (round up)
        }
      }
    }

    // Calculate deadline (createdAt + maxDays)
    const deadline = new Date(createdAt);
    deadline.setDate(deadline.getDate() + maxDays);

    // Calculate days left
    const now = new Date();
    const timeDiff = deadline.getTime() - now.getTime();
    const daysLeft = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));

    return {
      daysLeft: Math.max(0, daysLeft), // Don't return negative days
      deadline,
      urgencyDuration: duration,
      isOverdue: daysLeft < 0,
    };
  } catch (error) {
    console.error("Error calculating days left:", error);
    // Return default values on error
    return {
      daysLeft: 0,
      deadline: new Date(),
      urgencyDuration: "",
      isOverdue: false,
    };
  }
};

/**
 * Enrich managed service with days left calculation
 * @param {Object} managedService - ManagedService document
 * @param {Object} settings - SystemSettings object (optional)
 * @returns {Object} - ManagedService with daysLeft, deadline, urgencyDuration added
 */
export const enrichManagedService = async (managedService, settings = null) => {
  if (!managedService || !managedService.urgency || !managedService.createdAt) {
    return managedService;
  }

  const daysLeftData = await calculateDaysLeft(
    managedService.urgency,
    managedService.createdAt,
    settings
  );

  // Convert to plain object if it's a Mongoose document
  const enriched = managedService.toObject ? managedService.toObject() : { ...managedService };
  
  enriched.daysLeft = daysLeftData.daysLeft;
  enriched.deadline = daysLeftData.deadline;
  enriched.urgencyDuration = daysLeftData.urgencyDuration;
  enriched.isOverdue = daysLeftData.isOverdue;

  return enriched;
};

/**
 * Enrich multiple managed services with days left calculation
 * @param {Array} managedServices - Array of ManagedService documents
 * @param {Object} settings - SystemSettings object (optional)
 * @returns {Array} - Array of enriched ManagedService objects
 */
export const enrichManagedServices = async (managedServices, settings = null) => {
  if (!Array.isArray(managedServices)) {
    return managedServices;
  }

  // Fetch settings once if not provided
  if (!settings) {
    settings = await SystemSettings.findOne({ key: "pricing_config" });
  }

  // Enrich all services
  const enriched = await Promise.all(
    managedServices.map((service) => enrichManagedService(service, settings))
  );

  return enriched;
};

