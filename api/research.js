// NEWSFORGE AI
// Research & Verification Engine
// api/research.js

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || "gemini-3.6-flash";
const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/* -------------------------------------------------------
   BASIC HELPERS
------------------------------------------------------- */

function cleanText(value, max = 5000) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, max);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 100) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function normalizeConfidence(value) {
  const n = clamp(value, 0, 100);

  if (n >= 85) return "HIGH";
  if (n >= 65) return "MEDIUM";
  return "LOW";
}

function normalizeStatus(value) {
  const allowed = [
    "VERIFIED",
    "PARTIALLY_VERIFIED",
    "UNVERIFIED",
    "CONFLICTING",
    "RESEARCH_FAILED"
  ];

  const status = cleanText(value, 50).toUpperCase();

  return allowed.includes(status) ? status : "UNVERIFIED";
}

function normalizeRiskLevel(value) {
  const allowed = ["LOW", "MEDIUM", "HIGH", "CRITICAL"];
  const level = cleanText(value, 30).toUpperCase();

  return allowed.includes(level) ? level : "MEDIUM";
}

function uniqueStrings(items) {
  const seen = new Set();

  return safeArray(items)
    .map(item => cleanText(item, 2000))
    .filter(item => {
      if (!item) return false;

      const key = item.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);
      return true;
    });
}

function uniqueSources(items) {
  const seen = new Set();

  return safeArray(items)
    .map(source => {
      if (!source || typeof source !== "object") return null;

      return {
        title: cleanText(source.title, 300),
        url: cleanText(source.url, 2000),
        publisher: cleanText(source.publisher, 200),
        date: cleanText(source.date, 100)
      };
    })
    .filter(source => {
      if (!source) return false;

      const key =
        source.url ||
        `${source.publisher}:${source.title}`.toLowerCase();

      if (seen.has(key)) return false;

      seen.add(key);

      return Boolean(source.title || source.url || source.publisher);
    });
}

/* -------------------------------------------------------
   HTTP
------------------------------------------------------- */

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);

  const text = await response.text();

  let data;

  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = {
      raw: text
    };
  }

  if (!response.ok) {
    const error = new Error(
      data?.error?.message ||
      data?.message ||
      `HTTP ${response.status}`
    );

    error.status = response.status;
    error.response = data;

    throw error;
  }

  return data;
}

/* -------------------------------------------------------
   ARTICLE NORMALIZATION
------------------------------------------------------- */

function normalizeArticle(article) {
  if (!article || typeof article !== "object") {
    return null;
  }

  return {
    source:
      typeof article.source === "object"
        ? {
            id: cleanText(article.source?.id, 200),
            name: cleanText(article.source?.name, 300)
          }
        : {
            name: cleanText(article.source, 300)
          },

    author: cleanText(article.author, 500),

    title: cleanText(article.title, 1000),

    description: cleanText(article.description, 3000),

    content: cleanText(article.content, 8000),

    url: cleanText(article.url, 3000),

    image: cleanText(
      article.image ||
      article.urlToImage ||
      article.imageUrl,
      3000
    ),

    publishedAt: cleanText(
      article.publishedAt ||
      article.published_at ||
      article.date,
      200
    )
  };
}

/* -------------------------------------------------------
   GEMINI RESPONSE EXTRACTION
------------------------------------------------------- */

function collectTextFromObject(value, output = []) {
  if (!value) return output;

  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectTextFromObject(item, output);
    }

    return output;
  }

  if (typeof value === "object") {
    if (typeof value.text === "string") {
      output.push(value.text);
    }

    for (const key of Object.keys(value)) {
      if (
        key === "text" ||
        key === "thought" ||
        key === "thought_signature"
      ) {
        continue;
      }

      collectTextFromObject(value[key], output);
    }
  }

  return output;
}

function extractGeminiText(data) {
  const chunks = [];

  if (Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      if (step?.type === "model_output") {
        collectTextFromObject(step.content, chunks);
      }
    }
  }

  if (Array.isArray(data?.outputs)) {
    for (const output of data.outputs) {
      collectTextFromObject(output, chunks);
    }
  }

  if (typeof data?.text === "string") {
    chunks.push(data.text);
  }

  if (typeof data?.output_text === "string") {
    chunks.push(data.output_text);
  }

  if (typeof data?.response?.text === "string") {
    chunks.push(data.response.text);
  }

  return chunks
    .join("\n")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

/* -------------------------------------------------------
   JSON EXTRACTION
------------------------------------------------------- */

function extractJson(text) {
  if (!text) {
    throw new Error("Gemini returned an empty response.");
  }

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstObject = cleaned.indexOf("{");
  const lastObject = cleaned.lastIndexOf("}");

  if (firstObject !== -1 && lastObject > firstObject) {
    const candidate = cleaned.slice(
      firstObject,
      lastObject + 1
    );

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  const firstArray = cleaned.indexOf("[");
  const lastArray = cleaned.lastIndexOf("]");

  if (firstArray !== -1 && lastArray > firstArray) {
    const candidate = cleaned.slice(
      firstArray,
      lastArray + 1
    );

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error("Gemini returned invalid JSON.");
}

/* -------------------------------------------------------
   URL EXTRACTION
------------------------------------------------------- */

function extractUrls(value, urls = []) {
  if (!value) return urls;

  if (typeof value === "string") {
    const matches = value.match(
      /https?:\/\/[^\s"'<>]+/gi
    ) || [];

    for (const url of matches) {
      urls.push(url.replace(/[),.;]+$/, ""));
    }

    return urls;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      extractUrls(item, urls);
    }

    return urls;
  }

  if (typeof value === "object") {
    for (const key of Object.keys(value)) {
      extractUrls(value[key], urls);
    }
  }

  return urls;
}

function normalizeExtractedUrls(data) {
  return [...new Set(
    extractUrls(data)
      .filter(url => /^https?:\/\//i.test(url))
      .slice(0, 30)
  )];
}

/* -------------------------------------------------------
   SAFETY RULES
------------------------------------------------------- */

function editorialSafety(article) {
  const text = [
    article.title,
    article.description,
    article.content
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const flags = [];

  const rules = [
    {
      pattern: /\b(death|dead|died|dies|killed|murder|suicide)\b/i,
      flag: "Potential death or fatality claim"
    },

    {
      pattern: /\b(terror|terrorist|bomb|blast|explosion)\b/i,
      flag: "Potential terrorism or attack claim"
    },

    {
      pattern: /\b(rape|sexual assault|molestation)\b/i,
      flag: "Sensitive sexual-crime claim"
    },

    {
      pattern: /\b(communal|riot|religious violence)\b/i,
      flag: "Potential communal or civil-unrest claim"
    },

    {
      pattern: /\b(election|poll|vote|voting|ballot)\b/i,
      flag: "Election-related claim"
    },

    {
      pattern: /\b(minister|prime minister|president|politician|government)\b/i,
      flag: "Political or government-related claim"
    },

    {
      pattern: /\b(cancer|covid|vaccine|medical|disease|drug)\b/i,
      flag: "Medical or health-related claim"
    },

    {
      pattern: /\b(accused|alleged|allegation|charges|fraud|scam)\b/i,
      flag: "Allegation or accusation"
    },

    {
      pattern: /\b(earthquake|flood|cyclone|disaster|emergency)\b/i,
      flag: "Potential disaster or emergency"
    }
  ];

  for (const rule of rules) {
    if (rule.pattern.test(text)) {
      flags.push(rule.flag);
    }
  }

  return {
    humanReviewRequired: flags.length > 0,
    flags: [...new Set(flags)]
  };
}

/* -------------------------------------------------------
   RESEARCH PROMPT
------------------------------------------------------- */

function buildResearchPrompt(article, safety) {
  return `
You are NEWSFORGE AI's research and verification engine.

Your job is to investigate a news story before it is allowed to become social-media content.

IMPORTANT EDITORIAL RULES:

1. Do not assume the supplied article is true.
2. Treat the supplied article as an initial lead, not established fact.
3. Use current web information.
4. Cross-check important claims against multiple independent sources.
5. Prefer primary sources, official government sources, official statements,
   reputable news organizations, public records, and direct documentation.
6. Distinguish confirmed facts from allegations, predictions, opinions,
   speculation and unverified reports.
7. Never manufacture sources or URLs.
8. If evidence conflicts, explicitly say so.
9. Deaths, disasters, crime, politics, elections, communal issues,
   medical claims and allegations require heightened caution.
10. Do not recommend automatic publication when material uncertainty remains.
11. If the story cannot be adequately verified, mark it UNVERIFIED.
12. If reliable sources directly disagree, mark it CONFLICTING.
13. Confidence must reflect evidence quality, not how confidently the
    original article was written.

ORIGINAL STORY:

Title:
${article.title}

Description:
${article.description}

Article content:
${article.content}

Publisher:
${article.source?.name || "Unknown"}

Author:
${article.author || "Unknown"}

Published:
${article.publishedAt || "Unknown"}

Original URL:
${article.url || "Unavailable"}

EDITORIAL SAFETY FLAGS:

${safety.flags.length
  ? safety.flags.map(flag => `- ${flag}`).join("\n")
  : "- No automatic high-risk keyword flag detected."}

RESEARCH TASK:

A. Identify the main factual claims.
B. Search the current web for corroborating evidence.
C. Look for contradictory evidence.
D. Determine what is actually established.
E. Identify important missing information.
F. Evaluate source quality.
G. Determine whether this story is suitable for content generation.
H. Recommend whether a human editor must review it.
I. Provide useful source URLs discovered during research.
J. Never invent evidence.

Return ONLY valid JSON matching the requested schema.
`;
}

/* -------------------------------------------------------
   GEMINI RESEARCH
------------------------------------------------------- */

async function runGeminiResearch(article, safety) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured in Vercel environment variables."
    );
  }

  const responseSchema = {
    type: "object",

    properties: {
      research_status: {
        type: "string",
        enum: [
          "VERIFIED",
          "PARTIALLY_VERIFIED",
          "UNVERIFIED",
          "CONFLICTING"
        ]
      },

      confidence: {
        type: "number"
      },

      executive_summary: {
        type: "string"
      },

      cross_check_summary: {
        type: "string"
      },

      key_claims: {
        type: "array",
        items: {
          type: "string"
        }
      },

      supporting_evidence: {
        type: "array",
        items: {
          type: "string"
        }
      },

      conflicting_evidence: {
        type: "array",
        items: {
          type: "string"
        }
      },

      risk_flags: {
        type: "array",
        items: {
          type: "object",
          properties: {
            level: {
              type: "string",
              enum: [
                "LOW",
                "MEDIUM",
                "HIGH",
                "CRITICAL"
              ]
            },

            reason: {
              type: "string"
            }
          },

          required: [
            "level",
            "reason"
          ]
        }
      },

      recommendation: {
        type: "string"
      },

      sources: {
        type: "array",
        items: {
          type: "object",

          properties: {
            title: {
              type: "string"
            },

            url: {
              type: "string"
            },

            publisher: {
              type: "string"
            },

            date: {
              type: "string"
            }
          },

          required: [
            "title",
            "url",
            "publisher",
            "date"
          ]
        }
      }
    },

    required: [
      "research_status",
      "confidence",
      "executive_summary",
      "cross_check_summary",
      "key_claims",
      "supporting_evidence",
      "conflicting_evidence",
      "risk_flags",
      "recommendation",
      "sources"
    ]
  };

  const payload = {
    model: MODEL,

    input: buildResearchPrompt(article, safety),

    tools: [
      {
        type: "google_search"
      },

      {
        type: "url_context"
      }
    ],

    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: responseSchema
    }
  };

  const data = await fetchJson(GEMINI_URL, {
    method: "POST",

    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": GEMINI_API_KEY
    },

    body: JSON.stringify(payload)
  });

  const text = extractGeminiText(data);

  if (!text) {
    throw new Error(
      "Gemini research completed without returning model text."
    );
  }

  const parsed = extractJson(text);

  return {
    parsed,
    rawResponse: data
  };
}

/* -------------------------------------------------------
   NORMALIZE RESEARCH
------------------------------------------------------- */

function normalizeResearch(parsed, article, safety, rawResponse) {
  const sourceList = uniqueSources(parsed?.sources);

  const extractedUrls = normalizeExtractedUrls(
    rawResponse
  );

  for (const url of extractedUrls) {
    if (!sourceList.some(source => source.url === url)) {
      sourceList.push({
        title: "Web source",
        url,
        publisher: "",
        date: ""
      });
    }
  }

  const confidenceNumber = clamp(
    parsed?.confidence,
    0,
    100
  );

  const riskFlags = safeArray(parsed?.risk_flags)
    .map(flag => {
      if (typeof flag === "string") {
        return {
          level: "MEDIUM",
          reason: cleanText(flag, 1000)
        };
      }

      return {
        level: normalizeRiskLevel(flag?.level),
        reason: cleanText(flag?.reason, 1000)
      };
    })
    .filter(flag => flag.reason);

  for (const flag of safety.flags) {
    riskFlags.push({
      level: "HIGH",
      reason: flag
    });
  }

  const dedupedRiskFlags = [];

  const seenRisks = new Set();

  for (const flag of riskFlags) {
    const key =
      `${flag.level}:${flag.reason}`.toLowerCase();

    if (!seenRisks.has(key)) {
      seenRisks.add(key);
      dedupedRiskFlags.push(flag);
    }
  }

  const requiresHumanReview =
    safety.humanReviewRequired ||
    confidenceNumber < 85 ||
    parsed?.research_status === "UNVERIFIED" ||
    parsed?.research_status === "CONFLICTING" ||
    parsed?.research_status === "PARTIALLY_VERIFIED" ||
    dedupedRiskFlags.some(
      flag =>
        flag.level === "HIGH" ||
        flag.level === "CRITICAL"
    );

  return {
    research_status: normalizeStatus(
      parsed?.research_status
    ),

    confidence: confidenceNumber,

    confidence_label:
      normalizeConfidence(confidenceNumber),

    executive_summary:
      cleanText(
        parsed?.executive_summary,
        5000
      ) ||
      "No executive summary was returned.",

    cross_check_summary:
      cleanText(
        parsed?.cross_check_summary,
        5000
      ) ||
      "No cross-check summary was returned.",

    key_claims:
      uniqueStrings(parsed?.key_claims),

    supporting_evidence:
      uniqueStrings(
        parsed?.supporting_evidence
      ),

    conflicting_evidence:
      uniqueStrings(
        parsed?.conflicting_evidence
      ),

    risk_flags:
      dedupedRiskFlags,

    recommendation:
      cleanText(
        parsed?.recommendation,
        4000
      ) ||
      "Human verification is recommended before publication.",

    sources:
      sourceList.slice(0, 30),

    human_verification_required:
      requiresHumanReview,

    content_generation_allowed:
      !requiresHumanReview &&
      confidenceNumber >= 85 &&
      (
        parsed?.research_status === "VERIFIED"
      ),

    article: {
      title: article.title,
      url: article.url,
      source: article.source?.name || "",
      publishedAt: article.publishedAt || ""
    }
  };
}

/* -------------------------------------------------------
   FAILURE RESPONSE
------------------------------------------------------- */

function failureResponse(error, article) {
  const message =
    error?.message ||
    "Unknown research engine error.";

  return {
    success: false,

    research: {
      research_status: "RESEARCH_FAILED",

      confidence: 0,

      confidence_label: "LOW",

      executive_summary:
        "The research engine could not complete verification.",

      cross_check_summary:
        "No verification result is available because the research request failed.",

      key_claims: [],

      supporting_evidence: [],

      conflicting_evidence: [],

      risk_flags: [
        {
          level: "HIGH",
          reason:
            "Research engine failure. Do not treat the original story as verified."
        }
      ],

      recommendation:
        "Do not publish automatically. Retry the research request or perform manual verification.",

      sources: [],

      human_verification_required: true,

      content_generation_allowed: false,

      article: {
        title: article?.title || "",
        url: article?.url || "",
        source: article?.source?.name || "",
        publishedAt: article?.publishedAt || ""
      }
    },

    error: {
      type: "research_engine_error",
      message,
      details:
        error?.response || null
    }
  };
}

/* -------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------- */

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({
      success: false,
      error: {
        type: "method_not_allowed",
        message: "Use POST /api/research"
      }
    });
  }

  try {
    const body = req.body || {};

    const article = normalizeArticle(
      body.article
    );

    if (!article) {
      return res.status(400).json({
        success: false,
        error: {
          type: "invalid_article",
          message:
            "A valid article object is required."
        }
      });
    }

    if (!article.title && !article.url) {
      return res.status(400).json({
        success: false,
        error: {
          type: "missing_article_data",
          message:
            "The article must contain at least a title or URL."
        }
      });
    }

    const safety = editorialSafety(article);

    const result =
      await runGeminiResearch(
        article,
        safety
      );

    const research =
      normalizeResearch(
        result.parsed,
        article,
        safety,
        result.rawResponse
      );

    return res.status(200).json({
      success: true,

      research,

      // Top-level fields kept for
      // frontend compatibility.
      research_status:
        research.research_status,

      confidence:
        research.confidence,

      executive_summary:
        research.executive_summary,

      cross_check_summary:
        research.cross_check_summary,

      key_claims:
        research.key_claims,

      supporting_evidence:
        research.supporting_evidence,

      conflicting_evidence:
        research.conflicting_evidence,

      risk_flags:
        research.risk_flags,

      recommendation:
        research.recommendation,

      sources:
        research.sources,

      human_verification_required:
        research.human_verification_required,

      content_generation_allowed:
        research.content_generation_allowed
    });

  } catch (error) {
    console.error(
      "NEWSFORGE research error:",
      error
    );

    // Return 200 so the frontend can display
    // a structured research failure instead of
    // crashing on a generic server error.
    return res.status(200).json(
      failureResponse(
        error,
        req.body?.article || {}
      )
    );
  }
}
