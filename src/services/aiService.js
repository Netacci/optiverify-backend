import Groq from "groq-sdk";
import dotenv from "dotenv";

dotenv.config();

const client = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const isDev = process.env.NODE_ENV === "development";
if (isDev) {
  if (process.env.GROQ_API_KEY) {
    console.log(
      "✅ Groq AI enabled - hybrid matching active (llama-3.3-70b-versatile)"
    );
  } else {
    console.log(
      "⚠️  GROQ_API_KEY not found - AI scoring will fall back to keyword matching"
    );
  }
}

// ========== UTILITIES ==========

/**
 * Parse the first integer from strings like "500 units", "min 500", "500+"
 */
function parseQuantityNumber(text) {
  if (!text) return null;
  const match = String(text).match(/\d[\d,]*/);
  if (!match) return null;
  return parseInt(match[0].replace(/,/g, ""), 10);
}

// ========== HARD FILTER ==========

/**
 * Returns true if supplier passes category/subcategory filter.
 * Category match is mandatory. Subcategory match is mandatory only when
 * the request specifies a subcategory.
 */
function getRequestSubCategory(request) {
  return (request.subCategory ?? request.subcategory)?.trim() || "";
}

export function passesHardFilter(request, supplier) {
  if (!request.category || !supplier.category) {
    if (isDev) console.log(`  [FILTER] SKIP "${supplier.name}" — missing category (request: "${request.category}", supplier: "${supplier.category}")`);
    return false;
  }

  const reqCat = request.category.toLowerCase().trim();
  const supCat = supplier.category.toLowerCase().trim();
  if (reqCat !== supCat) {
    if (isDev) console.log(`  [FILTER] SKIP "${supplier.name}" — category mismatch ("${reqCat}" vs "${supCat}")`);
    return false;
  }

  const reqSub = getRequestSubCategory(request);
  if (reqSub) {
    if (!supplier.subCategory || !supplier.subCategory.trim()) {
      if (isDev) console.log(`  [FILTER] SKIP "${supplier.name}" — no subCategory set on supplier (request subCategory: "${reqSub}")`);
      return false;
    }
    const supSub = supplier.subCategory.toLowerCase().trim();
    if (reqSub.toLowerCase() !== supSub) {
      if (isDev) console.log(`  [FILTER] SKIP "${supplier.name}" — subCategory mismatch ("${reqSub}" vs "${supSub}")`);
      return false;
    }
  }

  if (isDev) console.log(`  [FILTER] PASS "${supplier.name}" — category: "${supCat}"${supplier.subCategory ? ` | subCategory: "${supplier.subCategory.toLowerCase().trim()}"` : ""}`);
  return true;
}

// ========== INDIVIDUAL SCORING FACTORS ==========

/**
 * Keyword overlap: item name tokens vs supplier capabilities text.
 * Returns 0–40 points. Used as pre-payment scoring and AI fallback.
 * Gives a base of 15 when the supplier has listed capabilities but no
 * literal keyword hit — the hard filter already confirmed category match,
 * so a supplier with relevant capabilities is not a zero.
 */
function scoreItemNameKeyword(itemName, capabilities) {
  if (!itemName || !capabilities || capabilities.length === 0) return 0;

  const tokens = itemName
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 2);
  if (tokens.length === 0) return 0;

  const capText = capabilities.join(" ").toLowerCase();
  const hits = tokens.filter((token) => capText.includes(token)).length;

  // No literal keyword hit but supplier has listed capabilities → base 15 pts
  if (hits === 0) return 15;

  // 1+ hits → scale 15–40
  return Math.min(40, 15 + Math.round((hits / tokens.length) * 25));
}


/**
 * MOQ compatibility: compares parsed supplier MOQ against parsed request quantity.
 * Returns 20 (compatible), 10 (no quantity entered, benefit of doubt), or 0 (too low).
 */
function scoreMOQ(request, supplier) {
  const supplierMOQ = parseQuantityNumber(supplier.minOrderQuantity);

  // No MOQ set = accepts any quantity
  if (supplierMOQ === null) return 20;

  const requestQty = parseQuantityNumber(request.quantity);

  // Buyer didn't specify quantity — partial credit, don't penalise
  if (requestQty === null) return 10;

  return requestQty >= supplierMOQ ? 20 : 0;
}

/**
 * Certifications: matches supplier certifications against request requirements text.
 * No requirements specified (or "none"/"n/a"/"-") → full 15 pts (benefit of doubt).
 * Requirements specified → 15 pts if any cert matches, 0 if none match.
 */
function scoreCertifications(request, supplier) {
  const req = request.requirements?.trim() || "";
  const noReq = !req || /^(none|n\/a|na|no|-)$/i.test(req);

  // Buyer didn't specify any requirements — award full score
  if (noReq) return 15;

  // Buyer specified requirements but supplier has no certifications listed
  if (!supplier.certifications || supplier.certifications.length === 0) return 0;

  const reqLower = req.toLowerCase();
  const matches = supplier.certifications.filter((cert) =>
    reqLower.includes(cert.toLowerCase())
  );
  return matches.length > 0 ? 15 : 0;
}

// ========== PRE-PAYMENT: RULE-BASED SCORE ==========

/**
 * Pure rule-based score for pre-payment preview (no AI calls).
 * Caller must already have confirmed supplier passes passesHardFilter().
 *
 * Scoring (100 pts total):
 *   Item name keyword match  0–40
 *   Subcategory              35   (always full — hard filter already guarantees compatibility)
 *   MOQ compatibility        0–20
 *   Certifications           0–15 (full if buyer didn't specify requirements)
 */
export function calculatePreviewScore(request, supplier) {
  const factors = [];

  const itemScore = scoreItemNameKeyword(request.name, supplier.capabilities);
  // Subcategory is always 35: passesHardFilter() already excluded any supplier
  // whose subcategory doesn't match, so every supplier here is compatible.
  const subcategoryScore = 35;
  const moqScore = scoreMOQ(request, supplier);
  const certScore = scoreCertifications(request, supplier);

  if (itemScore > 0) factors.push("Item relevance match");
  factors.push("Subcategory match");
  if (moqScore === 20) factors.push("MOQ compatible");
  else if (moqScore === 10) factors.push("MOQ unverified (quantity not entered)");
  if (certScore === 15) {
    factors.push(
      !request.requirements || !request.requirements.trim()
        ? "Certifications (no requirements — full credit)"
        : "Certification match"
    );
  }

  const rawScore = itemScore + subcategoryScore + moqScore + certScore;
  const score = Math.min(100, Math.max(70, rawScore));

  if (isDev) {
    console.log(
      `  [PREVIEW] ${supplier.name} | ` +
      `item=${itemScore}/40 | subcategory=35/35 | moq=${moqScore}/20 | certs=${certScore}/15 | ` +
      `RAW=${rawScore}/100 | FINAL=${score}/100 (floor 70)`
    );
  }

  return { score, factors };
}

// ========== POST-PAYMENT: HYBRID SCORE (Groq + rule-based) ==========

/**
 * AI: Score item name vs supplier capabilities using Groq.
 * Returns { score: 0–40, reason: string }.
 * Falls back to keyword overlap if Groq fails.
 */
async function scoreItemNameAI(request, supplier) {
  const capabilities = supplier.capabilities || [];

  const reqSub = getRequestSubCategory(request);
  const prompt = `You are a supply chain specialist evaluating supplier-buyer product compatibility.

BUYER ITEM: "${request.name}"
BUYER CATEGORY: ${request.category}${reqSub ? ` > ${reqSub}` : ""}
BUYER DESCRIPTION: ${request.description || "Not provided"}

SUPPLIER CAPABILITIES: ${capabilities.length > 0 ? capabilities.join(", ") : "None listed"}

TASK: Score how well this supplier's capabilities align with the buyer's specific item on a scale of 0 to 40.

SCORING GUIDE:
- 35–40: Direct match — supplier explicitly handles this exact product or a direct synonym
- 25–34: Strong match — supplier's capabilities clearly cover this type of item or close category
- 15–24: Moderate match — supplier operates in the same domain but is not a precise fit
- 5–14: Weak match — some related capabilities exist but significant gaps remain
- 0–4: Poor or no match — capabilities are unrelated, generic, or the list is empty

IMPORTANT RULES:
- Account for industry synonyms (e.g. "aluminum extrusions" matches "metal extrusion services"; "corrugated boxes" matches "packaging manufacturing")
- Do NOT reward generic category-level capabilities that any supplier in that category would have
- If the capabilities list is empty or none listed, score must be 0
- Be strict: a score above 30 requires clear, specific alignment

Return ONLY this JSON object with no other text or markdown:
{"score": <integer 0-40>, "reason": "<one concise sentence>"}`;

  try {
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a supply chain matching specialist. Return only valid JSON. No markdown, no explanation outside the JSON object.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.1,
      max_tokens: 100,
    });

    const raw = response.choices[0].message.content
      .trim()
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    // Extract first JSON object so we tolerate extra text before/after
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    const toParse = jsonMatch ? jsonMatch[0] : raw;
    const parsed = JSON.parse(toParse);
    return {
      score: Math.min(40, Math.max(0, Number(parsed.score) || 0)),
      reason: parsed.reason || "",
    };
  } catch (err) {
    if (isDev) console.error(
      "Groq scoreItemNameAI failed, falling back to keyword:",
      err.message
    );
    return {
      score: scoreItemNameKeyword(request.name, capabilities),
      reason: "Scored by keyword overlap (AI unavailable)",
    };
  }
}

/**
 * Full hybrid score for post-payment full report.
 * AI scores item name; everything else is deterministic.
 * Caller must already have confirmed supplier passes passesHardFilter().
 */
export async function calculateHybridScore(request, supplier) {
  const itemNameResult = await scoreItemNameAI(request, supplier);

  // Subcategory is always 35: passesHardFilter() already guarantees compatibility.
  const subcategoryScore = 35;
  const moqScore = scoreMOQ(request, supplier);
  const certScore = scoreCertifications(request, supplier);

  const factors = [];
  if (itemNameResult.score > 0)
    factors.push(`Item match: ${itemNameResult.reason}`);
  factors.push("Subcategory match");
  if (moqScore === 20) factors.push("MOQ compatible");
  else if (moqScore === 10) factors.push("MOQ unverified (quantity not entered)");
  if (certScore === 15) {
    factors.push(
      !request.requirements || !request.requirements.trim()
        ? "Certifications (no requirements — full credit)"
        : "Certification match"
    );
  }

  const rawScore = itemNameResult.score + subcategoryScore + moqScore + certScore;
  const score = Math.min(100, Math.max(60, rawScore));

  if (isDev) {
    console.log(
      `  [HYBRID]  ${supplier.name} | ` +
      `item(AI)=${itemNameResult.score}/40 (${itemNameResult.reason}) | ` +
      `subcategory=35/35 | moq=${moqScore}/20 | certs=${certScore}/15 | ` +
      `RAW=${rawScore}/100 | FINAL=${score}/100 (floor 60)`
    );
  }

  return { score, factors };
}

// ========== POST-PAYMENT: EXPLANATIONS ==========

/**
 * Generate "why they match" explanation using Groq for top-5 suppliers.
 * Falls back to template if Groq fails.
 */
export async function generateWhyTheyMatch(
  request,
  supplier,
  matchScore,
  factors
) {
  const reqSub = getRequestSubCategory(request);
  const prompt = `You are a procurement analyst writing a supplier match summary for a buyer's paid report.

BUYER REQUEST:
- Item: ${request.name}
- Category: ${request.category}${reqSub ? ` > ${reqSub}` : ""}
- Description: ${request.description || "Not provided"}
- Quantity: ${request.quantity || "Not specified"}
- Requirements / Certifications: ${request.requirements || "None"}

MATCHED SUPPLIER:
- Name: ${supplier.name}
- Category: ${supplier.category}${supplier.subCategory ? ` > ${supplier.subCategory}` : ""}
- Capabilities: ${supplier.capabilities?.join(", ") || "Not listed"}
- Certifications: ${supplier.certifications?.join(", ") || "None"}
- Min Order Quantity: ${supplier.minOrderQuantity || "No minimum"}
- Match Score: ${matchScore}/100
- Matching Factors: ${factors.join(", ")}

Write exactly 2–3 sentences explaining why this supplier is a good match for this buyer. Be specific and reference actual data above. Do not use filler phrases like "this supplier is well-positioned" or "they stand out". Do not mention the numeric score.`;

  try {
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a professional procurement analyst. Write factual, specific, concise supplier match summaries. Use only information provided. No fluff.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.4,
      max_tokens: 160,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    if (isDev) console.error(
      "Groq generateWhyTheyMatch failed, using template:",
      err.message
    );
    return generateTemplateExplanation(request, supplier, matchScore, factors);
  }
}

/**
 * Generate a 2-sentence summary of the buyer request for the report header.
 * Falls back to description truncation if Groq fails.
 */
export async function generateRequestSummary(request) {
  const reqSub = getRequestSubCategory(request);
  const prompt = `Summarize this procurement request in exactly 2 sentences for a supplier match report. Be factual and specific.

Item: ${request.name}
Category: ${request.category}${reqSub ? ` > ${reqSub}` : ""}
Quantity: ${request.quantity || "Not specified"}
Description: ${request.description || "Not provided"}
Location Preference: ${request.location || "Not specified"}
Requirements: ${request.requirements || "None"}`;

  try {
    const response = await client.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content:
            "You are a business analyst. Write exactly 2 factual sentences summarizing procurement requests. Use only the data provided. No speculation.",
        },
        { role: "user", content: prompt },
      ],
      temperature: 0.3,
      max_tokens: 120,
    });

    return response.choices[0].message.content.trim();
  } catch (err) {
    if (isDev) console.error(
      "Groq generateRequestSummary failed, using fallback:",
      err.message
    );
    return request.description
      ? request.description.substring(0, 200)
      : `Request for ${request.name} in the ${request.category} category.`;
  }
}

// ========== FALLBACK TEMPLATE ==========

/**
 * Template-based explanation when Groq is unavailable.
 */
export function generateTemplateExplanation(
  request,
  supplier,
  matchScore,
  factors
) {
  const factorsArray = Array.isArray(factors) ? factors : [];
  const parts = [];

  if (matchScore >= 80) {
    parts.push("Excellent alignment with your procurement requirements.");
  } else if (matchScore >= 60) {
    parts.push("Strong compatibility with your key requirements.");
  } else {
    parts.push("Relevant capabilities matching your category needs.");
  }

  if (supplier.capabilities?.length > 0) {
    parts.push(
      `Their capabilities include ${supplier.capabilities.slice(0, 3).join(", ")}.`
    );
  }

  if (supplier.certifications?.length > 0) {
    parts.push(`Certified: ${supplier.certifications.join(", ")}.`);
  }

  return parts.join(" ");
}

// ========== BACKWARD-COMPAT ALIASES ==========
// These keep the matchController imports working without changes.
export const calculateRuleBasedScore = calculatePreviewScore;
export const calculateAIMatchScore = async (request, supplier) => {
  const result = await calculateHybridScore(request, supplier);
  return { ...result, score: result.score, whyMatch: "", strengths: [], concerns: [], aiGenerated: true };
};
export const generateAIExplanation = generateWhyTheyMatch;
