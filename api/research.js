/**
 * NEWSFORGE AI
 * Research & Verification Engine
 *
 * Purpose:
 * - Research a selected news story using Gemini
 * - Search the live web for independent corroboration
 * - Inspect the original source when possible
 * - Extract and evaluate factual claims
 * - Detect contradictions and uncertainty
 * - Score source quality and evidence strength
 * - Produce a structured editorial research report
 *
 * Runtime:
 * - Vercel Serverless Function
 * - Node.js 18+
 *
 * Required environment variable:
 * - GEMINI_API_KEY
 *
 * Gemini:
 * - Interactions API
 * - Gemini 3.6 Flash
 * - Google Search grounding
 * - URL Context
 * - Structured JSON output
 *
 * IMPORTANT:
 * Research is NOT editorial approval.
 * This endpoint never publishes content.
 * Sensitive or uncertain stories remain subject to human approval.
 */

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_MODEL = "gemini-3.6-flash";

const REQUEST_TIMEOUT_MS = 60000;
const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 3000;
const MAX_CONTENT_LENGTH = 12000;
const MAX_URL_LENGTH = 2000;
const MAX_SOURCE_LENGTH = 300;

const SENSITIVE_PATTERNS = [
  /\bdeath\b/i,
  /\bdead\b/i,
  /\bdied\b/i,
  /\bkilled\b/i,
  /\bmurder\b/i,
  /\bsuicide\b/i,
  /\bterror(?:ism|ist)?\b/i,
  /\battack\b/i,
  /\bbomb\b/i,
  /\bexplosion\b/i,
  /\bcommunal\b/i,
  /\briot\b/i,
  /\belection\b/i,
  /\bvoting\b/i,
  /\bvote\b/i,
  /\bpolitic(?:s|al)\b/i,
  /\bminister\b/i,
  /\bprime minister\b/i,
  /\bpresident\b/i,
  /\bchief minister\b/i,
  /\bgovernment\b/i,
  /\bcrime\b/i,
  /\barrest(?:ed)?\b/i,
  /\baccused\b/i,
  /\balleg(?:e|ed|ation)\b/i,
  /\bscam\b/i,
  /\bfraud\b/i,
  /\bcorruption\b/i,
  /\bmedical\b/i,
  /\bhealth\b/i,
  /\bdisease\b/i,
  /\boutbreak\b/i,
  /\bepidemic\b/i,
  /\bpandemic\b/i,
  /\bearthquake\b/i,
  /\bflood\b/i,
  /\bcyclone\b/i,
  /\bdisaster\b/i,
  /\bcasualt(?:y|ies)\b/i
];

const ALLOWED_METHODS = ["POST", "OPTIONS"];

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Vary", "Origin");
}

function json(res, statusCode, payload) {
  setCors(res);
  res.status(statusCode).json(payload);
}

function cleanString(value, maxLength) {
  if (value === undefined || value === null) return "";

  return String(value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) return min;

  return Math.min(max, Math.max(min, Math.round(number)));
}

function uniqueStrings(values) {
  return [
    ...new Set(
      (Array.isArray(values) ? values : [])
        .map((value) => cleanString(value, 2000))
        .filter(Boolean)
    )
  ];
}

function isValidHttpUrl(value) {
  try {
    const parsed = new URL(value);

    return (
      parsed.protocol === "http:" ||
      parsed.protocol === "https:"
    );
  } catch {
    return false;
  }
}

function normalizeUrl(value) {
  const url = cleanString(value, MAX_URL_LENGTH);

  if (!isValidHttpUrl(url)) {
    return "";
  }

  return url;
}

function looksSensitive(story) {
  const text = [
    story.title,
    story.description,
    story.content,
    story.category
  ]
    .filter(Boolean)
    .join(" ");

  return SENSITIVE_PATTERNS.some((pattern) => pattern.test(text));
}

function safeDate(value) {
  const raw = cleanString(value, 100);

  if (!raw) return null;

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function nowIso() {
  return new Date().toISOString();
}

function truncateText(value, maxLength) {
  const text = cleanString(value, maxLength);

  if (text.length <= maxLength) {
    return text;
  }

  return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}

/* -------------------------------------------------------------------------- */
/* Request body normalization                                                 */
/* -------------------------------------------------------------------------- */

function extractStory(body) {
  const candidate =
    body &&
    typeof body.story === "object" &&
    body.story !== null
      ? body.story
      : body || {};

  return {
    id: cleanString(
      candidate.id ||
        candidate.storyId ||
        body?.storyId ||
        `story_${Date.now()}`,
      200
    ),

    title: cleanString(
      candidate.title ||
        candidate.headline ||
        body?.title,
      MAX_TITLE_LENGTH
    ),

    description: cleanString(
      candidate.description ||
        candidate.summary ||
        body?.description,
      MAX_DESCRIPTION_LENGTH
    ),

    content: cleanString(
      candidate.content ||
        candidate.article ||
        candidate.body ||
        body?.content,
      MAX_CONTENT_LENGTH
    ),

    url: normalizeUrl(
      candidate.url ||
        candidate.link ||
        candidate.sourceUrl ||
        body?.url ||
        body?.sourceUrl
    ),

    source: cleanString(
      candidate.source ||
        candidate.sourceName ||
        candidate.publisher ||
        body?.source,
      MAX_SOURCE_LENGTH
    ),

    publishedAt: safeDate(
      candidate.publishedAt ||
        candidate.published_at ||
        candidate.date ||
        body?.publishedAt
    ),

    category: cleanString(
      candidate.category ||
        body?.category,
      100
    ),

    trendScore: clamp(
      candidate.trendScore ||
        candidate.trend_score ||
        body?.trendScore ||
        0,
      0,
      100
    ),

    confidence: clamp(
      candidate.confidence ||
        body?.confidence ||
        0,
      0,
      100
    )
  };
}

function validateStory(story) {
  const errors = [];

  if (!story.title) {
    errors.push("A story title is required.");
  }

  if (story.title.length < 8) {
    errors.push("The story title is too short to research reliably.");
  }

  if (!story.url && !story.description && !story.content) {
    errors.push(
      "Provide at least a source URL, description, or article content."
    );
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Gemini response extraction                                                 */
/* -------------------------------------------------------------------------- */

function getStepText(step) {
  if (!step) return "";

  if (typeof step === "string") {
    return step;
  }

  if (Array.isArray(step.content)) {
    return step.content
      .map((item) => {
        if (typeof item === "string") return item;

        return (
          item?.text ||
          item?.content ||
          item?.value ||
          ""
        );
      })
      .filter(Boolean)
      .join("\n");
  }

  return (
    step.text ||
    step.output_text ||
    step.output ||
    ""
  );
}

function extractModelText(response) {
  if (!response || typeof response !== "object") {
    return "";
  }

  if (Array.isArray(response.steps)) {
    const text = response.steps
      .map(getStepText)
      .filter(Boolean)
      .join("\n");

    if (text) return text;
  }

  if (Array.isArray(response.outputs)) {
    const text = response.outputs
      .map(getStepText)
      .filter(Boolean)
      .join("\n");

    if (text) return text;
  }

  if (typeof response.output_text === "string") {
    return response.output_text;
  }

  if (typeof response.text === "string") {
    return response.text;
  }

  if (typeof response.output === "string") {
    return response.output;
  }

  return "";
}

/* -------------------------------------------------------------------------- */
/* JSON extraction                                                            */
/* -------------------------------------------------------------------------- */

function stripMarkdownCodeFence(text) {
  return String(text || "")
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function extractJsonObject(text) {
  const cleaned = stripMarkdownCodeFence(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue with bounded object extraction.
  }

  const firstBrace = cleaned.indexOf("{");
  const lastBrace = cleaned.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("Gemini returned no JSON object.");
  }

  const candidate = cleaned.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(candidate);
  } catch {
    throw new Error(
      "Gemini returned malformed JSON research output."
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Citation / URL extraction                                                  */
/* -------------------------------------------------------------------------- */

function collectUrls(value, output = []) {
  if (!value) return output;

  if (typeof value === "string") {
    const matches =
      value.match(
        /https?:\/\/[^\s"'<>]+/gi
      ) || [];

    for (const match of matches) {
      output.push(
        match.replace(/[),.;]+$/, "")
      );
    }

    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectUrls(item, output);
    }

    return output;
  }

  if (typeof value === "object") {
    for (const [key, item] of Object.entries(value)) {
      if (
        /url|uri|link|source/i.test(key) ||
        typeof item === "object"
      ) {
        collectUrls(item, output);
      }
    }
  }

  return output;
}

function collectCitationObjects(value, output = []) {
  if (!value) return output;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectCitationObjects(item, output);
    }

    return output;
  }

  if (typeof value !== "object") {
    return output;
  }

  const url =
    value.url ||
    value.uri ||
    value.link;

  if (
    typeof url === "string" &&
    isValidHttpUrl(url)
  ) {
    output.push({
      url,
      title:
        cleanString(
          value.title ||
            value.name ||
            value.source ||
            "",
          300
        ) || null,
      source:
        cleanString(
          value.source ||
            value.domain ||
            value.publisher ||
            "",
          300
        ) || null
    });
  }

  for (const item of Object.values(value)) {
    if (item && typeof item === "object") {
      collectCitationObjects(item, output);
    }
  }

  return output;
}

function hostnameFromUrl(url) {
  try {
    return new URL(url).hostname
      .replace(/^www\./i, "");
  } catch {
    return "";
  }
}

function dedupeSources(sources) {
  const map = new Map();

  for (const source of sources || []) {
    if (!source?.url) continue;

    const normalized = normalizeUrl(source.url);

    if (!normalized) continue;

    const key = normalized
      .toLowerCase()
      .replace(/\/$/, "");

    if (!map.has(key)) {
      map.set(key, {
        url: normalized,
        title: source.title || null,
        source:
          source.source ||
          hostnameFromUrl(normalized)
      });
    }
  }

  return [...map.values()];
}

/* -------------------------------------------------------------------------- */
/* Research schema                                                            */
/* -------------------------------------------------------------------------- */

const RESEARCH_SCHEMA = {
  type: "object",
  properties: {
    researchStatus: {
      type: "string",
      enum: [
        "researched",
        "partially_researched",
        "insufficient_evidence"
      ]
    },

    executiveSummary: {
      type: "string"
    },

    eventSummary: {
      type: "string"
    },

    whatIsKnown: {
      type: "array",
      items: {
        type: "string"
      }
    },

    whatIsNotKnown: {
      type: "array",
      items: {
        type: "string"
      }
    },

    keyClaims: {
      type: "array",
      items: {
        type: "object",
        properties: {
          claim: {
            type: "string"
          },
          status: {
            type: "string",
            enum: [
              "supported",
              "partially_supported",
              "unverified",
              "contradicted"
            ]
          },
          confidence: {
            type: "integer"
          },
          evidence: {
            type: "string"
          }
        },
        required: [
          "claim",
          "status",
          "confidence",
          "evidence"
        ]
      }
    },

    corroboration: {
      type: "object",
      properties: {
        independentSourcesFound: {
          type: "integer"
        },
        strongCorroboration: {
          type: "boolean"
        },
        corroborationSummary: {
          type: "string"
        }
      },
      required: [
        "independentSourcesFound",
        "strongCorroboration",
        "corroborationSummary"
      ]
    },

    contradictions: {
      type: "array",
      items: {
        type: "object",
        properties: {
          topic: {
            type: "string"
          },
          sourceA: {
            type: "string"
          },
          sourceB: {
            type: "string"
          },
          explanation: {
            type: "string"
          },
          severity: {
            type: "string",
            enum: [
              "low",
              "medium",
              "high",
              "critical"
            ]
          }
        },
        required: [
          "topic",
          "sourceA",
          "sourceB",
          "explanation",
          "severity"
        ]
      }
    },

    sourceAssessment: {
      type: "array",
      items: {
        type: "object",
        properties: {
          source: {
            type: "string"
          },
          role: {
            type: "string",
            enum: [
              "primary",
              "independent",
              "secondary",
              "context",
              "uncertain"
            ]
          },
          quality: {
            type: "integer"
          },
          reasoning: {
            type: "string"
          }
        },
        required: [
          "source",
          "role",
          "quality",
          "reasoning"
        ]
      }
    },

    factCheck: {
      type: "object",
      properties: {
        confidence: {
          type: "integer"
        },
        factualRisk: {
          type: "string",
          enum: [
            "low",
            "medium",
            "high",
            "critical"
          ]
        },
        unresolvedIssues: {
          type: "array",
          items: {
            type: "string"
          }
        }
      },
      required: [
        "confidence",
        "factualRisk",
        "unresolvedIssues"
      ]
    },

    editorialRecommendation: {
      type: "string",
      enum: [
        "publish",
        "hold",
        "reject"
      ]
    },

    verificationPriority: {
      type: "string",
      enum: [
        "routine",
        "important",
        "urgent",
        "critical"
      ]
    },

    humanApprovalRequired: {
      type: "boolean"
    },

    verificationChecklist: {
      type: "array",
      items: {
        type: "string"
      }
    },

    suggestedHeadline: {
      type: "string"
    },

    neutralAngle: {
      type: "string"
    }
  },

  required: [
    "researchStatus",
    "executiveSummary",
    "eventSummary",
    "whatIsKnown",
    "whatIsNotKnown",
    "keyClaims",
    "corroboration",
    "contradictions",
    "sourceAssessment",
    "factCheck",
    "editorialRecommendation",
    "verificationPriority",
    "humanApprovalRequired",
    "verificationChecklist",
    "suggestedHeadline",
    "neutralAngle"
  ]
};

/* -------------------------------------------------------------------------- */
/* Gemini prompt                                                              */
/* -------------------------------------------------------------------------- */

function buildResearchPrompt(story, sensitive) {
  const originalSource = story.url
    ? `
ORIGINAL SOURCE URL:
${story.url}
`
    : "ORIGINAL SOURCE URL: Not provided";

  return `
You are the senior research and verification engine inside NEWSFORGE AI.

Your job is NOT to write sensational content.
Your job is to determine what can responsibly be established about a news story.

This is an India-focused news intelligence platform, but the story may involve international events.

RESEARCH OBJECTIVES

1. Investigate the supplied story.
2. Use Google Search to find current, independent reporting and primary sources.
3. Use URL Context to inspect the original source URL when it is available.
4. Separate confirmed facts from claims, speculation, opinions and unknowns.
5. Identify the most important factual claims.
6. Determine whether those claims are independently corroborated.
7. Detect contradictions between sources.
8. Assess source quality.
9. Produce an overall confidence score.
10. Recommend publish, hold or reject from an editorial-risk perspective.
11. Never invent facts, sources, quotations, statistics, dates or URLs.
12. Do not treat multiple articles repeating the same wire report as independent corroboration.
13. Prefer primary sources, official statements, government records and direct evidence where appropriate.
14. Distinguish allegations from established facts.
15. Preserve uncertainty instead of filling gaps with assumptions.

EDITORIAL RULES

A story must NOT be treated as fully verified merely because:
- one publication reports it,
- several websites repeat the same claim,
- the headline is confident,
- social media is discussing it,
- the event is trending.

For breaking news, prefer current evidence but explicitly identify what remains unconfirmed.

For deaths, crime, allegations, communal incidents, disasters, elections, political claims, medical claims, financial claims or other sensitive subjects, apply a higher verification threshold.

The final recommendation is an internal editorial recommendation only.
It does NOT authorize publication.

STORY

TITLE:
${story.title}

DESCRIPTION:
${story.description || "Not provided"}

ARTICLE CONTENT:
${story.content || "Not provided"}

SOURCE:
${story.source || "Unknown"}

PUBLISHED AT:
${story.publishedAt || "Unknown"}

CATEGORY:
${story.category || "Unknown"}

TREND SCORE:
${story.trendScore}

${originalSource}

SENSITIVE-STORY FLAG:
${sensitive ? "YES. Apply heightened verification standards." : "NO. Normal verification standards apply."}

OUTPUT REQUIREMENTS

Return ONLY the requested structured JSON.

The JSON must:
- summarize the event accurately,
- list what is known,
- list what is not known,
- evaluate key claims,
- explain corroboration,
- expose contradictions,
- assess source quality,
- provide factual confidence,
- identify unresolved issues,
- provide a conservative editorial recommendation,
- provide a verification checklist,
- suggest a neutral headline and angle.

Do not claim that a source was consulted unless the available research actually supports that conclusion.
Do not fabricate source names.
Do not manufacture citations.
`;
}

/* -------------------------------------------------------------------------- */
/* Gemini request                                                             */
/* -------------------------------------------------------------------------- */

async function callGeminiResearch(story, sensitive) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server."
    );
  }

  const payload = {
    model: GEMINI_MODEL,

    input: buildResearchPrompt(
      story,
      sensitive
    ),

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
      schema: RESEARCH_SCHEMA
    }
  };

  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, REQUEST_TIMEOUT_MS);

  let response;

  try {
    response = await fetch(
      GEMINI_ENDPOINT,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key":
            process.env.GEMINI_API_KEY
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }
    );
  } catch (error) {
    if (error?.name === "AbortError") {
      throw new Error(
        "Gemini research request timed out."
      );
    }

    throw new Error(
      `Gemini research network error: ${
        error?.message || "Unknown error"
      }`
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawText = await response.text();

  let data = null;

  try {
    data = rawText
      ? JSON.parse(rawText)
      : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const apiMessage =
      data?.error?.message ||
      data?.message ||
      truncateText(rawText, 1000) ||
      `HTTP ${response.status}`;

    throw new Error(
      `Gemini research request failed: ${apiMessage}`
    );
  }

  const modelText = extractModelText(data);

  if (!modelText) {
    throw new Error(
      "Gemini returned an empty research response."
    );
  }

  let research;

  try {
    research = extractJsonObject(modelText);
  } catch (error) {
    throw new Error(
      error?.message ||
        "Unable to parse Gemini research output."
    );
  }

  return {
    research,
    rawResponse: data
  };
}

/* -------------------------------------------------------------------------- */
/* Research normalization                                                     */
/* -------------------------------------------------------------------------- */

function normalizeResearch(research, story, sensitive) {
  const result =
    research &&
    typeof research === "object"
      ? research
      : {};

  const keyClaims = Array.isArray(result.keyClaims)
    ? result.keyClaims.map((claim) => ({
        claim: cleanString(claim?.claim, 2000),
        status:
          [
            "supported",
            "partially_supported",
            "unverified",
            "contradicted"
          ].includes(claim?.status)
            ? claim.status
            : "unverified",
        confidence: clamp(
          claim?.confidence,
          0,
          100
        ),
        evidence: cleanString(
          claim?.evidence,
          3000
        )
      }))
    : [];

  const sourceAssessment = Array.isArray(
    result.sourceAssessment
  )
    ? result.sourceAssessment.map((source) => ({
        source: cleanString(
          source?.source,
          500
        ),
        role:
          [
            "primary",
            "independent",
            "secondary",
            "context",
            "uncertain"
          ].includes(source?.role)
            ? source.role
            : "uncertain",
        quality: clamp(
          source?.quality,
          0,
          100
        ),
        reasoning: cleanString(
          source?.reasoning,
          2000
        )
      }))
    : [];

  const contradictions = Array.isArray(
    result.contradictions
  )
    ? result.contradictions.map((item) => ({
        topic: cleanString(
          item?.topic,
          500
        ),
        sourceA: cleanString(
          item?.sourceA,
          500
        ),
        sourceB: cleanString(
          item?.sourceB,
          500
        ),
        explanation: cleanString(
          item?.explanation,
          2500
        ),
        severity:
          [
            "low",
            "medium",
            "high",
            "critical"
          ].includes(item?.severity)
            ? item.severity
            : "medium"
      }))
    : [];

  const unresolvedIssues = Array.isArray(
    result.factCheck?.unresolvedIssues
  )
    ? uniqueStrings(
        result.factCheck.unresolvedIssues
      )
    : [];

  const checklist = Array.isArray(
    result.verificationChecklist
  )
    ? uniqueStrings(
        result.verificationChecklist
      )
    : [];

  const confidence = clamp(
    result.factCheck?.confidence,
    0,
    100
  );

  const factualRisk =
    [
      "low",
      "medium",
      "high",
      "critical"
    ].includes(result.factCheck?.factualRisk)
      ? result.factCheck.factualRisk
      : confidence >= 85
      ? "low"
      : confidence >= 65
      ? "medium"
      : confidence >= 40
      ? "high"
      : "critical";

  let recommendation =
    [
      "publish",
      "hold",
      "reject"
    ].includes(
      result.editorialRecommendation
    )
      ? result.editorialRecommendation
      : "hold";

  /*
   * Safety override:
   * Research can never turn a sensitive story into
   * an automatically publishable story.
   */
  if (
    sensitive ||
    factualRisk === "high" ||
    factualRisk === "critical" ||
    confidence < 80 ||
    contradictions.some(
      (item) =>
        item.severity === "critical" ||
        item.severity === "high"
    )
  ) {
    recommendation = "hold";
  }

  let verificationPriority =
    [
      "routine",
      "important",
      "urgent",
      "critical"
    ].includes(result.verificationPriority)
      ? result.verificationPriority
      : "important";

  if (sensitive) {
    verificationPriority =
      confidence < 60
        ? "critical"
        : "urgent";
  }

  return {
    researchStatus:
      [
        "researched",
        "partially_researched",
        "insufficient_evidence"
      ].includes(result.researchStatus)
        ? result.researchStatus
        : "partially_researched",

    executiveSummary: cleanString(
      result.executiveSummary,
      5000
    ),

    eventSummary: cleanString(
      result.eventSummary,
      5000
    ),

    whatIsKnown: uniqueStrings(
      result.whatIsKnown
    ),

    whatIsNotKnown: uniqueStrings(
      result.whatIsNotKnown
    ),

    keyClaims,

    corroboration: {
      independentSourcesFound: clamp(
        result.corroboration
          ?.independentSourcesFound,
        0,
        100
      ),

      strongCorroboration:
        result.corroboration
          ?.strongCorroboration === true,

      corroborationSummary:
        cleanString(
          result.corroboration
            ?.corroborationSummary,
          3000
        )
    },

    contradictions,

    sourceAssessment,

    factCheck: {
      confidence,
      factualRisk,
      unresolvedIssues
    },

    editorialRecommendation:
      recommendation,

    verificationPriority,

    humanApprovalRequired: true,

    verificationChecklist: checklist,

    suggestedHeadline: cleanString(
      result.suggestedHeadline ||
        story.title,
      MAX_TITLE_LENGTH
    ),

    neutralAngle: cleanString(
      result.neutralAngle,
      2500
    )
  };
}

/* -------------------------------------------------------------------------- */
/* Source extraction                                                          */
/* -------------------------------------------------------------------------- */

function buildSources(
  originalStory,
  geminiResponse,
  research
) {
  const sources = [];

  if (originalStory.url) {
    sources.push({
      url: originalStory.url,
      title:
        originalStory.title ||
        "Original story source",
      source:
        originalStory.source ||
        hostnameFromUrl(
          originalStory.url
        ),
      role: "primary"
    });
  }

  const citationObjects =
    collectCitationObjects(
      geminiResponse
    );

  for (const citation of citationObjects) {
    sources.push({
      ...citation,
      role: "research"
    });
  }

  const urls = collectUrls(
    geminiResponse
  );

  for (const url of urls) {
    sources.push({
      url,
      title: null,
      source: hostnameFromUrl(url),
      role: "research"
    });
  }

  /*
   * If Gemini explicitly names source records,
   * preserve their names even when no URL was exposed.
   */
  if (
    Array.isArray(
      research?.sourceAssessment
    )
  ) {
    for (
      const source of research.sourceAssessment
    ) {
      if (
        source?.source &&
        !source?.source.startsWith("http")
      ) {
        sources.push({
          url: null,
          title: source.source,
          source: source.source,
          role: source.role
        });
      }
    }
  }

  const deduped = [];
  const seenUrls = new Set();
  const seenNames = new Set();

  for (const source of sources) {
    const urlKey = source.url
      ? source.url
          .toLowerCase()
          .replace(/\/$/, "")
      : null;

    const nameKey = cleanString(
      source.source ||
        source.title ||
        "",
      500
    )
      .toLowerCase();

    if (
      urlKey &&
      seenUrls.has(urlKey)
    ) {
      continue;
    }

    if (
      !urlKey &&
      nameKey &&
      seenNames.has(nameKey)
    ) {
      continue;
    }

    if (urlKey) {
      seenUrls.add(urlKey);
    }

    if (nameKey) {
      seenNames.add(nameKey);
    }

    deduped.push({
      url: source.url || null,
      title: source.title || null,
      source:
        source.source ||
        (source.url
          ? hostnameFromUrl(source.url)
          : null),
      role: source.role || "research"
    });
  }

  return deduped;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export default async function handler(
  req,
  res
) {
  setCors(res);

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  if (req.method !== "POST") {
    return json(res, 405, {
      success: false,
      error: {
        code: "METHOD_NOT_ALLOWED",
        message:
          "Research endpoint accepts POST requests only."
      }
    });
  }

  const startedAt = Date.now();

  try {
    let body = req.body;

    if (
      typeof body === "string"
    ) {
      try {
        body = JSON.parse(body);
      } catch {
        return json(res, 400, {
          success: false,
          error: {
            code: "INVALID_JSON",
            message:
              "Request body contains invalid JSON."
          }
        });
      }
    }

    if (
      !body ||
      typeof body !== "object"
    ) {
      return json(res, 400, {
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message:
            "A JSON request body is required."
        }
      });
    }

    const story =
      extractStory(body);

    const validationErrors =
      validateStory(story);

    if (validationErrors.length) {
      return json(res, 400, {
        success: false,
        error: {
          code: "INVALID_STORY",
          message:
            "The supplied story cannot be researched.",
          details:
            validationErrors
        }
      });
    }

    const sensitive =
      looksSensitive(story);

    const {
      research,
      rawResponse
    } =
      await callGeminiResearch(
        story,
        sensitive
      );

    const normalizedResearch =
      normalizeResearch(
        research,
        story,
        sensitive
      );

    const sources =
      buildSources(
        story,
        rawResponse,
        normalizedResearch
      );

    const durationMs =
      Date.now() - startedAt;

    const result = {
      success: true,

      system: {
        name: "NEWSFORGE AI",
        module: "RESEARCH",
        version: "2.0.0",
        status: "operational",
        generatedAt: nowIso(),
        durationMs
      },

      ai: {
        enabled: true,
        provider: "Google Gemini",
        model: GEMINI_MODEL,
        tools: [
          "Google Search",
          "URL Context"
        ]
      },

      editorial: {
        publicationAllowed: false,
        humanApprovalRequired: true,
        sensitiveStory: sensitive,
        recommendation:
          normalizedResearch
            .editorialRecommendation,
        note:
          "Research provides evidence and risk assessment. It does not constitute editorial approval or authorize publication."
      },

      story: {
        id: story.id,
        title: story.title,
        source: story.source || null,
        url: story.url || null,
        publishedAt:
          story.publishedAt,
        category:
          story.category || null,
        trendScore:
          story.trendScore
      },

      research: normalizedResearch,

      sources,

      verification: {
        status:
          normalizedResearch
            .researchStatus,

        confidence:
          normalizedResearch
            .factCheck.confidence,

        factualRisk:
          normalizedResearch
            .factCheck.factualRisk,

        priority:
          normalizedResearch
            .verificationPriority,

        unresolvedIssues:
          normalizedResearch
            .factCheck
            .unresolvedIssues,

        requiredBeforePublication:
          true
      }
    };

    return json(
      res,
      200,
      result
    );
  } catch (error) {
    console.error(
      "[NEWSFORGE RESEARCH]",
      error
    );

    const message =
      error?.message ||
      "Unexpected research engine failure.";

    const status =
      message.includes(
        "GEMINI_API_KEY"
      )
        ? 500
        : message.includes(
            "timed out"
          )
        ? 504
        : message.includes(
            "Gemini research request failed"
          )
        ? 502
        : 500;

    return json(res, status, {
      success: false,

      system: {
        name: "NEWSFORGE AI",
        module: "RESEARCH",
        version: "2.0.0",
        status: "degraded",
        generatedAt: nowIso()
      },

      error: {
        code:
          status === 504
            ? "RESEARCH_TIMEOUT"
            : status === 502
            ? "GEMINI_RESEARCH_ERROR"
            : status === 500 &&
              message.includes(
                "GEMINI_API_KEY"
              )
            ? "MISSING_GEMINI_API_KEY"
            : "RESEARCH_ENGINE_ERROR",

        message,

        publicationBlocked: true
      }
    });
  }
}
