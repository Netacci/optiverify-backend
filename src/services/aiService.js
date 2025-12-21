import OpenAI from "openai";
import dotenv from "dotenv";

dotenv.config();

// Initialize OpenAI client (will be null if no API key)
const openai = process.env.OPENAI_API_KEY
  ? new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    })
  : null;

// Log AI status on startup
if (openai) {
  console.log(
    "✅ OpenAI AI integration enabled - Using GPT-4o-mini for enhanced matching"
  );
} else {
  console.log(
    "⚠️  OpenAI API key not found - Using rule-based matching (fallback mode)"
  );
  console.log("   Add OPENAI_API_KEY to .env to enable AI features");
}

/**
 * Enhanced matching score calculation using AI
 * Retries once if AI fails, then falls back to rule-based
 */
export const calculateAIMatchScore = async (
  request,
  supplier,
  retryCount = 0
) => {
  // Fallback to rule-based if no OpenAI API key
  if (!openai) {
    return calculateRuleBasedScore(request, supplier);
  }

  try {
    const prompt = `You are an expert supplier matching system. Analyze how well this supplier matches the buyer's request.

BUYER REQUEST:
- Category: ${request.category}
- Description: ${request.description}
- Budget: ${request.budget || "Not specified"}
- Quantity: ${request.quantity || "Not specified"}
- Timeline: ${request.timeline || "Not specified"}
- Location: ${request.location || "Not specified"}
- Requirements: ${request.requirements || "None"}

SUPPLIER PROFILE:
- Category: ${supplier.category}
- Description: ${supplier.description}
- Location: ${supplier.location}
- Certifications: ${supplier.certifications.join(", ") || "None"}
- Capabilities: ${supplier.capabilities.join(", ") || "None"}
- Lead Time: ${supplier.leadTime || "Not specified"}
- Min Order Quantity: ${supplier.minOrderQuantity || "Not specified"}

Analyze the match and return a JSON object with:
1. "score": A number from 0-100 representing match quality
2. "factors": An array of specific matching factors (e.g., ["Category match", "Budget compatible", "Location suitable"])
3. "whyMatch": A brief explanation of why this supplier matches (2-3 sentences)
4. "strengths": An array of this supplier's key strengths for this request
5. "concerns": An array of any potential concerns or gaps (empty array if none)

Return ONLY valid JSON, no other text.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo", // Using cheaper model for cost efficiency
      messages: [
        {
          role: "system",
          content:
            "You are an expert supplier matching AI. Always return valid JSON only, no markdown formatting.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.3, // Lower temperature for more consistent scoring
      max_tokens: 500,
    });

    const responseText = completion.choices[0].message.content.trim();

    // Remove markdown code blocks if present
    const jsonText = responseText
      .replace(/```json\n?/g, "")
      .replace(/```\n?/g, "")
      .trim();

    const aiAnalysis = JSON.parse(jsonText);

    return {
      score: Math.min(100, Math.max(0, aiAnalysis.score || 0)),
      factors: aiAnalysis.factors || [],
      whyMatch: aiAnalysis.whyMatch || "",
      strengths: aiAnalysis.strengths || [],
      concerns: aiAnalysis.concerns || [],
      aiGenerated: true,
    };
  } catch (error) {
    console.error(
      `AI matching error (attempt ${retryCount + 1}):`,
      error.message
    );

    // Retry once if this is the first attempt
    if (retryCount === 0) {
      console.log("🔄 Retrying AI matching...");
      return calculateAIMatchScore(request, supplier, 1);
    }

    // After retry fails, fallback to rule-based
    console.log(
      "⚠️  AI matching failed twice, falling back to rule-based matching"
    );
    return calculateRuleBasedScore(request, supplier);
  }
};

/**
 * Generate AI-powered explanation for match
 * Retries once if AI fails, then falls back to template-based
 */
export const generateAIExplanation = async (
  request,
  supplier,
  matchScore,
  factors,
  retryCount = 0
) => {
  // Fallback to template-based if no OpenAI API key
  if (!openai) {
    return generateTemplateExplanation(request, supplier, matchScore, factors);
  }

  try {
    const prompt = `Generate a personalized, professional explanation for why this supplier is a good match for the buyer's request.

BUYER REQUEST:
- Category: ${request.category}
- Description: ${request.description}
- Budget: ${request.budget || "Not specified"}
- Requirements: ${request.requirements || "None"}

SUPPLIER:
- Name: ${supplier.name}
- Category: ${supplier.category}
- Location: ${supplier.location}
- Match Score: ${matchScore}%
- Matching Factors: ${factors.join(", ")}

Write a concise, professional explanation (2-3 sentences) that:
1. Highlights why this supplier matches the buyer's needs
2. Mentions specific relevant capabilities or certifications
3. Is personalized and not generic

Return only the explanation text, no labels or formatting.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a professional business consultant explaining supplier matches. Be concise and specific.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 200,
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error(
      `AI explanation error (attempt ${retryCount + 1}):`,
      error.message
    );

    // Retry once if this is the first attempt
    if (retryCount === 0) {
      console.log("🔄 Retrying AI explanation generation...");
      return generateAIExplanation(request, supplier, matchScore, factors, 1);
    }

    // After retry fails, fallback to template
    console.log(
      "⚠️  AI explanation failed twice, falling back to template-based explanation"
    );
    return generateTemplateExplanation(request, supplier, matchScore, factors);
  }
};

/**
 * Generate summary of the buyer request using AI
 * Retries once if AI fails, then falls back to truncation
 */
export const generateRequestSummary = async (request, retryCount = 0) => {
  // Fallback to simple truncation if no OpenAI API key
  if (!openai) {
    return request.description.substring(0, 200);
  }

  try {
    const prompt = `Summarize this buyer request in 2-3 sentences for a supplier match report:

Category: ${request.category}
Description: ${request.description}
Budget: ${request.budget || "Not specified"}
Quantity: ${request.quantity || "Not specified"}
Timeline: ${request.timeline || "Not specified"}
Location: ${request.location || "Not specified"}
Requirements: ${request.requirements || "None"}

Create a concise, professional summary that captures the key requirements.`;

    const completion = await openai.chat.completions.create({
      model: "gpt-3.5-turbo",
      messages: [
        {
          role: "system",
          content:
            "You are a professional business analyst. Create concise summaries. Use only information that is provided in the request only.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0.5,
      max_tokens: 150,
    });

    return completion.choices[0].message.content.trim();
  } catch (error) {
    console.error(
      `AI summary error (attempt ${retryCount + 1}):`,
      error.message
    );

    // Retry once if this is the first attempt
    if (retryCount === 0) {
      console.log("🔄 Retrying AI summary generation...");
      return generateRequestSummary(request, 1);
    }

    // After retry fails, fallback to truncation
    console.log(
      "⚠️  AI summary failed twice, falling back to description truncation"
    );
    return request.description.substring(0, 200);
  }
};

// ========== FALLBACK FUNCTIONS (Rule-based) ==========

/**
 * Rule-based matching score (fallback when AI is not available)
 */
export function calculateRuleBasedScore(request, supplier) {
  let score = 0;
  let factors = [];

  // Category match (40 points)
  if (request.category.toLowerCase() === supplier.category.toLowerCase()) {
    score += 40;
    factors.push("Category match");
  }

  // Location match (20 points)
  if (request.location) {
    const requestLocation = request.location.toLowerCase();
    const supplierLocation = supplier.location.toLowerCase();
    if (
      requestLocation.includes(supplierLocation) ||
      supplierLocation.includes(requestLocation)
    ) {
      score += 20;
      factors.push("Location match");
    } else {
      const commonWords = requestLocation
        .split(" ")
        .filter((word) => supplierLocation.includes(word) && word.length > 3);
      if (commonWords.length > 0) {
        score += 10;
        factors.push("Partial location match");
      }
    }
  }

  // Keyword/Description match (30 points)
  const requestText = `${request.description} ${
    request.requirements || ""
  }`.toLowerCase();
  const supplierText = `${supplier.description} ${supplier.capabilities.join(
    " "
  )}`.toLowerCase();

  const requestWords = requestText.split(/\s+/);
  const supplierWords = supplierText.split(/\s+/);
  const matchingWords = requestWords.filter(
    (word) => supplierWords.includes(word) && word.length > 4
  );

  if (matchingWords.length > 0) {
    score += Math.min(30, matchingWords.length * 5);
    factors.push(`${matchingWords.length} keyword matches`);
  }

  // Certifications match (10 points)
  if (request.requirements && request.requirements.trim()) {
    const reqLower = request.requirements.toLowerCase();
    const certMatches = supplier.certifications.filter((cert) =>
      reqLower.includes(cert.toLowerCase())
    );
    if (certMatches.length > 0) {
      score += 10;
      factors.push("Certification match");
    }
  }

  return {
    score: Math.min(100, score),
    factors,
    whyMatch: "",
    strengths: [],
    concerns: [],
    aiGenerated: false,
  };
}

/**
 * Template-based explanation (fallback when AI is not available)
 */
export function generateTemplateExplanation(
  request,
  supplier,
  matchScore,
  factors
) {
  const explanations = [];

  if (matchScore >= 80) {
    explanations.push(
      "Excellent match with strong alignment across multiple criteria."
    );
  } else if (matchScore >= 60) {
    explanations.push("Good match with solid compatibility in key areas.");
  } else {
    explanations.push("Moderate match with some relevant capabilities.");
  }

  if (factors.includes("Category match")) {
    explanations.push(
      `Specializes in ${supplier.category}, directly matching your needs.`
    );
  }

  if (supplier.certifications.length > 0) {
    explanations.push(`Certified with ${supplier.certifications.join(", ")}.`);
  }

  if (supplier.leadTime) {
    explanations.push(`Lead time: ${supplier.leadTime}.`);
  }

  return explanations.join(" ");
}
