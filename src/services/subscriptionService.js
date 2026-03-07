import User from "../models/common/User.js";

/**
 * Check if a user's subscription has expired and update status if necessary
 * @param {Object} user - User object or user ID
 * @returns {Promise<Object>} - Updated user object with correct subscription status
 */
export const checkAndUpdateSubscriptionStatus = async (user) => {
  // Fetch user if only ID is provided
  let userDoc = user;
  if (typeof user === "string") {
    userDoc = await User.findById(user);
    if (!userDoc) return null;
  }

  // Check if subscription status needs to be updated
  const now = new Date();
  if (
    userDoc.subscriptionStatus === "active" &&
    userDoc.subscriptionExpiresAt &&
    new Date(userDoc.subscriptionExpiresAt) < now
  ) {
    // Update subscription status to expired
    userDoc = await User.findByIdAndUpdate(
      userDoc._id,
      { subscriptionStatus: "expired" },
      { new: true }
    );
  }

  return userDoc;
};

/**
 * Check and update subscription status for multiple users
 * @param {Array} users - Array of user objects
 * @returns {Promise<Array>} - Array of users with updated subscription status
 */
export const checkAndUpdateMultipleSubscriptions = async (users) => {
  const now = new Date();

  return Promise.all(
    users.map(async (user) => {
      const userObj = user.toObject ? user.toObject() : user;

      if (
        userObj.subscriptionStatus === "active" &&
        userObj.subscriptionExpiresAt &&
        new Date(userObj.subscriptionExpiresAt) < now
      ) {
        // Update in database
        await User.findByIdAndUpdate(user._id || userObj._id, {
          subscriptionStatus: "expired",
        });
        userObj.subscriptionStatus = "expired";
      }

      return userObj;
    })
  );
};
