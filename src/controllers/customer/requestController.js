import BuyerRequest from "../../models/customer/BuyerRequest.js";
import User from "../../models/common/User.js";

// M-14 — Anonymous public-form abuse mitigation (defense-in-depth alongside
// the express-rate-limit middleware applied at server.js).
//
// Layers (in order):
//   1. Honeypot field — `req.body.website_url`. Real users leave the
//      offscreen-positioned input blank; bots that fill every field trip it.
//   2. Submission-window heuristic — `req.body.form_render_ts`. If the form
//      was submitted in <3s (or no timestamp present), treat as scripted.
//   3. Per-IP creation cap (anonymous only) — 10 creates / hour rolling.
//
// All three trigger SILENT-DROP: respond 200 OK with {success:true} so a bot
// can't tell whether it actually got in. Operators monitor the `console.warn`
// log lines for false positives — this is documented as A/B-testable. A
// future CAPTCHA (hCaptcha / Cloudflare Turnstile) layer can replace these
// heuristics.
const ANON_IP_CAP = 10; // creates per window
const ANON_IP_WINDOW_MS = 60 * 60 * 1000; // 1 hour rolling
const anonIpCreateCounts = new Map(); // ip -> { count, resetAt }

function sweepExpiredAnonIpCounts(now) {
  // Best-effort cleanup — no setInterval, runs on each anonymous create.
  for (const [ip, entry] of anonIpCreateCounts) {
    if (entry.resetAt <= now) anonIpCreateCounts.delete(ip);
  }
}

function getClientIp(req) {
  // express sets req.ip when `trust proxy` is on; fall back to socket.
  return (
    req.ip ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// Create a new buyer request
export const createRequest = async (req, res) => {
  try {
    // M-14 — Honeypot check. Bots tend to fill every visible field; this
    // input is hidden via offscreen CSS so a real user leaves it blank.
    if (
      typeof req.body?.website_url === "string" &&
      req.body.website_url.trim() !== ""
    ) {
      console.warn(
        `[createRequest][M-14] Honeypot tripped from ip=${getClientIp(req)} — silent-drop`
      );
      return res.status(200).json({ success: true });
    }

    // M-14 — Submission-window heuristic. Frontend stamps form_render_ts at
    // mount time; <3s means scripted submission. Absent timestamp is also
    // treated as bot (legitimate frontend always sends it).
    const renderTs = Number(req.body?.form_render_ts);
    const now = Date.now();
    if (!Number.isFinite(renderTs) || now - renderTs < 3000) {
      console.warn(
        `[createRequest][M-14] Submission-window heuristic tripped (renderTs=${req.body?.form_render_ts}, dt=${Number.isFinite(renderTs) ? now - renderTs : "n/a"}ms) from ip=${getClientIp(req)} — silent-drop`
      );
      return res.status(200).json({ success: true });
    }

    // M-14 — Per-IP creation cap for anonymous traffic. Authenticated users
    // bypass — they're already gated by auth + the standard rate limiters.
    if (!req.user) {
      sweepExpiredAnonIpCounts(now);
      const ip = getClientIp(req);
      const entry = anonIpCreateCounts.get(ip);
      if (entry && entry.resetAt > now) {
        if (entry.count >= ANON_IP_CAP) {
          console.warn(
            `[createRequest][M-14] Per-IP anon cap exceeded (${entry.count}/${ANON_IP_CAP}) from ip=${ip} — silent-drop`
          );
          return res.status(200).json({ success: true });
        }
        entry.count += 1;
      } else {
        anonIpCreateCounts.set(ip, {
          count: 1,
          resetAt: now + ANON_IP_WINDOW_MS,
        });
      }
    }

    // req.user is set by optionalAuth middleware if token exists

    const {
      name,
      category,
      unitPrice,
      quantity,
      description,
      timeline,
      location,
      requirements,
      email,
      // Legacy support for budget field
      budget,
    } = req.body;
    const subCategory = req.body.subCategory ?? req.body.subcategory;

    // Use authenticated user's email if available, otherwise use body email
    const userEmail = req.user?.email || email;

    // Validate required fields
    if (!name || !category || !unitPrice || !userEmail) {
      return res.status(400).json({
        success: false,
        message: "Name, category, unit price, and email are required",
        missing: {
          name: !name,
          category: !category,
          unitPrice: !unitPrice,
          email: !userEmail,
        },
      });
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(userEmail.trim())) {
      return res.status(400).json({
        success: false,
        message: "Please provide a valid email address",
      });
    }

    // Check if user exists with this email (only for public submissions, not authenticated users)
    if (!req.user) {
      const existingUser = await User.findOne({ email: userEmail.trim().toLowerCase() });
      
      // If user exists, they should submit from their dashboard, not the public form
      if (existingUser) {
        return res.status(400).json({
          success: false,
          message: "An account with this email already exists. Please log in to your dashboard to submit a request.",
          code: "USER_EXISTS",
          redirectUrl: `${process.env.CUSTOMER_DASHBOARD_URL || "http://localhost:3004"}/login`,
        });
      }
    }

    // Parse unit price (remove $ if present, handle commas)
    const unitPriceNum = parseFloat(String(unitPrice).replace(/[$,]/g, ""));
    if (isNaN(unitPriceNum) || unitPriceNum <= 0) {
      return res.status(400).json({
        success: false,
        message: "Unit price must be a valid positive number",
      });
    }

    // Parse quantity and calculate total amount
    let totalAmount = unitPriceNum;
    if (quantity) {
      // Extract number from quantity string (e.g., "1000 units" -> 1000)
      const quantityMatch = String(quantity).match(/(\d+(?:[.,]\d+)?)/);
      if (quantityMatch) {
        const quantityNum = parseFloat(quantityMatch[1].replace(/,/g, ""));
        if (!isNaN(quantityNum) && quantityNum > 0) {
          totalAmount = unitPriceNum * quantityNum;
        }
      }
    }

    // Create new buyer request
    const buyerRequest = new BuyerRequest({
      name,
      category,
      subCategory: subCategory || undefined,
      unitPrice: unitPriceNum,
      totalAmount,
      quantity,
      description,
      timeline,
      location,
      requirements,
      email: userEmail.trim(),
      status: "pending",
      // Keep budget for backward compatibility (deprecated)
      budget: budget || `$${totalAmount.toLocaleString()}`,
    });

    await buyerRequest.save();

    res.status(201).json({
      success: true,
      message: "Request submitted successfully",
      data: {
        id: buyerRequest._id,
        category: buyerRequest.category,
        status: buyerRequest.status,
        createdAt: buyerRequest.createdAt,
      },
    });
  } catch (error) {
    console.error("Error creating buyer request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// Get a specific buyer request by ID (C-3: now authenticated + ownership-checked)
export const getRequestById = async (req, res) => {
  try {
    const { id } = req.params;

    // C-3: Route is now mounted with `authenticate` middleware, so req.user is
    // guaranteed. Belt-and-suspenders defensive check in case the middleware
    // chain changes later.
    if (!req.user) {
      return res.status(401).json({
        success: false,
        message: "Authentication required",
      });
    }

    const buyerRequest = await BuyerRequest.findById(id);

    if (!buyerRequest) {
      return res.status(404).json({
        success: false,
        message: "Request not found",
      });
    }

    // Ownership enforcement.
    // 1) If the BuyerRequest has a userId (post H-7 migration), ObjectId equality
    //    is the source of truth.
    // 2) Otherwise fall back to case-insensitive trimmed email comparison.
    // TODO(H-7): once userId is backfilled and required, drop the email fallback.
    const reqUserEmail = (req.user.email || "").toLowerCase().trim();
    const recordEmail = (buyerRequest.email || "").toLowerCase().trim();

    if (buyerRequest.userId) {
      if (!buyerRequest.userId.equals(req.user._id)) {
        console.warn(
          `[getRequestById] Ownership denied (userId mismatch): user=${req.user._id} request=${id}`
        );
        return res.status(403).json({
          success: false,
          message: "Forbidden: you do not own this request",
        });
      }
    } else if (!reqUserEmail || reqUserEmail !== recordEmail) {
      console.warn(
        `[getRequestById] Ownership denied (email mismatch): user=${req.user._id} request=${id}`
      );
      return res.status(403).json({
        success: false,
        message: "Forbidden: you do not own this request",
      });
    }

    res.json({
      success: true,
      data: buyerRequest,
    });
  } catch (error) {
    console.error("Error fetching buyer request:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

// C-3: REMOVED from public routing — this dumped every buyer request in the
// system without auth. Kept exported (renamed) only so legacy importers don't
// break the build; do NOT mount it on a public route. Pending an admin-only
// rewrite (auth + pagination + audit log).
export const _getAllRequests_DEPRECATED = async (req, res) => {
  try {
    const requests = await BuyerRequest.find().sort({ createdAt: -1 });

    res.json({
      success: true,
      count: requests.length,
      data: requests,
    });
  } catch (error) {
    console.error("Error fetching buyer requests:", error);
    res.status(500).json({
      success: false,
      message: "Internal server error",
      error: process.env.NODE_ENV === "development" ? error.message : undefined,
    });
  }
};

