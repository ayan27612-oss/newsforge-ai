/**
 * ================================================================
 * NEWSFORGE AI
 * Discovery & Intelligence API
 * ================================================================
 *
 * Responsibility:
 *   1. Discover current news
 *   2. Focus on India-relevant intelligence
 *   3. Send discovered stories to Gemini
 *   4. Score trend potential
 *   5. Classify stories
 *   6. Identify stories requiring human verification
 *   7. Return a clean, frontend-ready intelligence payload
 *
 * Environment variables:
 *   NEWS_API_KEY
 *   GEMINI_API_KEY
 *
 * Endpoint:
 *   GET /api/news
 *
 * Architecture:
 *
 *   NEWS SOURCES
 *        ↓
 *   NEWS DISCOVERY
 *        ↓
 *   NORMALIZATION
 *        ↓
 *   GEMINI INTELLIGENCE
 *        ↓
 *   TREND SCORING
 *        ↓
 *   VERIFICATION GATE
 *        ↓
 *   FRONTEND
 *
 * Important:
 *   This endpoint does NOT publish anything.
 *   It only discovers and evaluates information.
 * ================================================================
 */

"use strict";

/* ================================================================
   CONFIGURATION
   ================================================================ */

const NEWS_API_BASE =
  "https://newsapi.org/v2/everything";

const GEMINI_INTERACTIONS_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_MODEL =
  "gemini-3.6-flash";

const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 50;

const REQUEST_TIMEOUT_MS = 15000;
const GEMINI_TIMEOUT_MS = 30000;

/*
 * These categories are intentionally broad.
 * The model can assign more precise classifications later.
 */
const CATEGORIES = [
  "politics",
  "business",
  "technology",
  "science",
  "health",
  "world",
  "sports",
  "entertainment",
  "environment",
  "security",
  "economy",
  "other"
];

/*
 * Stories involving these topics should receive stronger
 * verification requirements.
 */
const SENSITIVE_TERMS = [
  "death",
  "dead",
  "killed",
  "murder",
  "terror",
  "terrorist",
  "attack",
  "explosion",
  "earthquake",
  "war",
  "conflict",
  "communal",
  "religion",
  "election",
  "elections",
  "vote",
  "voting",
  "government",
  "minister",
  "prime minister",
  "president",
  "allegation",
  "alleged",
  "accused",
  "arrest",
  "crime",
  "fraud",
  "scam",
  "disease",
  "outbreak",
  "pandemic",
  "medical",
  "injured",
  "injury"
];

/* ================================================================
   GENERIC HELPERS
   ================================================================ */

/**
 * Safely convert any value into a trimmed string.
 */
function cleanString(value) {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim();
}

/**
 * Escape nothing here.
 *
 * This API returns JSON and does not render HTML.
 * Frontend rendering is responsible for HTML escaping.
 */

/**
 * Clamp a numeric value into a range.
 */
function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, number)
  );
}

/**
 * Convert unknown values into safe booleans.
 */
function toBoolean(value) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    return value.toLowerCase() === "true";
  }

  return Boolean(value);
}

/**
 * Generate a stable-ish story identifier.
 *
 * This is not a database primary key.
 * It is simply useful for frontend state and future workflow layers.
 */
function createStoryId(story, index) {

  const base = [
    story?.title,
    story?.source?.name,
    story?.publishedAt
  ]
    .filter(Boolean)
    .join("|")
    .toLowerCase();

  let hash = 0;

  for (let i = 0; i < base.length; i++) {
    hash =
      ((hash << 5) - hash) +
      base.charCodeAt(i);

    hash |= 0;
  }

  return `story_${Math.abs(hash)}_${index}`;
}

/**
 * Detect whether a story contains potentially sensitive material.
 *
 * This is deliberately conservative.
 */
function containsSensitiveTerms(story) {

  const text = [
    story?.title,
    story?.description,
    story?.content
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  return SENSITIVE_TERMS.some(
    (term) => text.includes(term)
  );
}

/**
 * Safe JSON parsing.
 */
function parseJSON(text) {

  if (!text) {
    throw new Error(
      "AI response was empty."
    );
  }

  /*
   * Sometimes models wrap JSON in markdown fences.
   * Remove those fences before parsing.
   */
  let cleaned = String(text)
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch (error) {

    /*
     * Attempt to recover the first JSON object or array.
     */
    const objectStart =
      cleaned.indexOf("{");

    const objectEnd =
      cleaned.lastIndexOf("}");

    const arrayStart =
      cleaned.indexOf("[");

    const arrayEnd =
      cleaned.lastIndexOf("]");

    if (
      objectStart !== -1 &&
      objectEnd > objectStart
    ) {
      const candidate =
        cleaned.slice(
          objectStart,
          objectEnd + 1
        );

      try {
        return JSON.parse(candidate);
      } catch (_) {}
    }

    if (
      arrayStart !== -1 &&
      arrayEnd > arrayStart
    ) {
      const candidate =
        cleaned.slice(
          arrayStart,
          arrayEnd + 1
        );

      try {
        return JSON.parse(candidate);
      } catch (_) {}
    }

    throw new Error(
      "AI response was not valid JSON."
    );
  }
}

/**
 * Create a timeout-controlled fetch request.
 */
async function fetchWithTimeout(
  url,
  options = {},
  timeout = REQUEST_TIMEOUT_MS
) {

  const controller =
    new AbortController();

  const timer =
    setTimeout(
      () => controller.abort(),
      timeout
    );

  try {

    return await fetch(
      url,
      {
        ...options,
        signal: controller.signal
      }
    );

  } finally {

    clearTimeout(timer);

  }
}

/**
 * Read an HTTP response safely.
 */
async function readJSONResponse(response) {

  const raw =
    await response.text();

  let parsed;

  try {
    parsed =
      raw ? JSON.parse(raw) : {};
  } catch (_) {

    parsed = {
      raw
    };

  }

  if (!response.ok) {

    const message =
      parsed?.message ||
      parsed?.error?.message ||
      parsed?.error ||
      `Request failed with HTTP ${response.status}`;

    throw new Error(message);
  }

  return parsed;
}

/* ================================================================
   NEWSAPI DISCOVERY
   ================================================================ */

/**
 * Build the discovery query.
 *
 * The goal is India relevance without limiting discovery to only
 * stories whose title literally contains "India".
 */
function buildNewsQuery() {

  return [
    "India",
    "Indian",
    "New Delhi",
    "Mumbai",
    "Bengaluru",
    "Modi",
    "Indian government",
    "Indian economy",
    "Indian markets",
    "India technology"
  ].join(" OR ");
}

/**
 * Discover stories from NewsAPI.
 */
async function fetchNews({
  apiKey,
  pageSize = DEFAULT_PAGE_SIZE,
  page = 1
}) {

  if (!apiKey) {
    throw new Error(
      "NEWS_API_KEY is not configured."
    );
  }

  const safePageSize =
    clamp(
      pageSize,
      1,
      MAX_PAGE_SIZE
    );

  const safePage =
    Math.max(
      1,
      Number(page) || 1
    );

  const params =
    new URLSearchParams({
      q: buildNewsQuery(),
      language: "en",
      sortBy: "publishedAt",
      pageSize: String(safePageSize),
      page: String(safePage),
      apiKey
    });

  const response =
    await fetchWithTimeout(
      `${NEWS_API_BASE}?${params.toString()}`,
      {
        method: "GET",
        headers: {
          "Accept": "application/json"
        }
      }
    );

  const data =
    await readJSONResponse(response);

  if (
    data.status &&
    data.status !== "ok"
  ) {
    throw new Error(
      data.message ||
      "News provider returned an unsuccessful response."
    );
  }

  return {
    articles: Array.isArray(data.articles)
      ? data.articles
      : [],
    totalResults:
      Number(data.totalResults) || 0
  };
}

/* ================================================================
   STORY NORMALIZATION
   ================================================================ */

function normalizeStory(
  article,
  index
) {

  const sourceName =
    cleanString(
      article?.source?.name
    ) || "Unknown Source";

  const title =
    cleanString(
      article?.title
    );

  const description =
    cleanString(
      article?.description
    );

  const content =
    cleanString(
      article?.content
    );

  const url =
    cleanString(
      article?.url
    );

  const image =
    cleanString(
      article?.urlToImage
    );

  const author =
    cleanString(
      article?.author
    );

  const publishedAt =
    cleanString(
      article?.publishedAt
    );

  const normalized = {

    id: createStoryId(
      article,
      index
    ),

    source: {
      name: sourceName,
      url
    },

    author,

    title,

    description,

    content,

    url,

    image,

    publishedAt,

    discoveredAt:
      new Date().toISOString()

  };

  normalized.sensitive =
    containsSensitiveTerms(
      normalized
    );

  return normalized;
}

/* ================================================================
   GEMINI INTELLIGENCE
   ================================================================ */

/**
 * Extract model text from the Interactions API.
 *
 * Current Interactions responses use steps[] containing
 * model_output/content objects.
 */
function extractGeminiText(data) {

  if (!data) {
    return "";
  }

  const chunks = [];

  if (Array.isArray(data.steps)) {

    for (const step of data.steps) {

      if (!step) {
        continue;
      }

      if (
        Array.isArray(step.content)
      ) {

        for (
          const item of step.content
        ) {

          if (
            item &&
            typeof item.text === "string"
          ) {
            chunks.push(
              item.text
            );
          }

        }

      }

    }

  }

  /*
   * Compatibility fallback for alternate response shapes.
   */
  if (
    !chunks.length &&
    Array.isArray(data.outputs)
  ) {

    for (
      const output of data.outputs
    ) {

      if (
        output &&
        typeof output.text === "string"
      ) {
        chunks.push(
          output.text
        );
      }

      if (
        output?.content &&
        Array.isArray(output.content)
      ) {

        for (
          const item of output.content
        ) {

          if (
            item &&
            typeof item.text === "string"
          ) {
            chunks.push(
              item.text
            );
          }

        }

      }

    }

  }

  return chunks
    .join("\n")
    .trim();
}

/**
 * Create the AI analysis schema.
 */
function getAnalysisSchema() {

  return {
    type: "object",

    properties: {

      stories: {
        type: "array",

        items: {
          type: "object",

          properties: {

            id: {
              type: "string"
            },

            trendScore: {
              type: "integer"
            },

            category: {
              type: "string",
              enum: CATEGORIES
            },

            priority: {
              type: "string",
              enum: [
                "critical",
                "high",
                "medium",
                "low"
              ]
            },

            audienceRelevance: {
              type: "integer"
            },

            attentionPotential: {
              type: "integer"
            },

            humanVerificationRequired: {
              type: "boolean"
            },

            confidence: {
              type: "integer"
            },

            reasoning: {
              type: "string"
            },

            verificationReason: {
              type: "string"
            }

          },

          required: [
            "id",
            "trendScore",
            "category",
            "priority",
            "audienceRelevance",
            "attentionPotential",
            "humanVerificationRequired",
            "confidence",
            "reasoning",
            "verificationReason"
          ]
        }
      }

    },

    required: [
      "stories"
    ]
  };
}

/**
 * Analyze stories with Gemini.
 */
async function analyzeStories(
  stories,
  apiKey
) {

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured."
    );
  }

  if (!stories.length) {
    return [];
  }

  const storyInput =
    stories.map(
      (story) => ({
        id: story.id,
        title: story.title,
        description: story.description,
        source: story.source.name,
        publishedAt: story.publishedAt,
        url: story.url,
        sensitive: story.sensitive
      })
    );

  const systemInstruction = `
You are NEWSFORGE AI, an editorial intelligence analyst.

Your task is to evaluate discovered news stories for an Indian audience.

You are NOT a publisher.

You must NOT invent facts.

You must evaluate only the information supplied in the input.

For each story:

1. Estimate TREND SCORE from 0 to 100.
2. Assign a broad category.
3. Assign priority:
   - critical
   - high
   - medium
   - low
4. Estimate audience relevance from 0 to 100.
5. Estimate attention potential from 0 to 100.
6. Decide whether human verification is required.
7. Estimate confidence from 0 to 100.
8. Explain the editorial reasoning briefly.
9. Explain why verification is or is not required.

IMPORTANT EDITORIAL RULES:

- A high trend score does NOT mean the story is verified.
- Breaking news requires caution.
- Deaths, disasters, allegations, crime, elections, political claims,
  communal matters, medical claims and major financial claims should
  generally require human verification.
- Never state an uncertain claim as established fact.
- Never fabricate missing information.
- Source credibility matters.
- Recency matters.
- India relevance matters.
- Potential attention should not override factual caution.

Return ONLY valid JSON matching the supplied schema.
`;

  const payload = {

    model: GEMINI_MODEL,

    input: [
      {
        role: "system",
        content: systemInstruction
      },
      {
        role: "user",
        content:
          JSON.stringify(
            {
              task:
                "Analyze the following discovered news stories.",
              stories: storyInput
            }
          )
      }
    ],

    response_format: {
      type: "text",
      mime_type: "application/json",
      schema:
        getAnalysisSchema()
    }

  };

  const response =
    await fetchWithTimeout(
      GEMINI_INTERACTIONS_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            apiKey,

          "Accept":
            "application/json"
        },

        body:
          JSON.stringify(payload)
      },
      GEMINI_TIMEOUT_MS
    );

  const data =
    await readJSONResponse(
      response
    );

  const text =
    extractGeminiText(data);

  if (!text) {
    throw new Error(
      "Gemini returned no model output."
    );
  }

  const parsed =
    parseJSON(text);

  if (
    !parsed ||
    !Array.isArray(parsed.stories)
  ) {

    throw new Error(
      "Gemini returned an unexpected intelligence structure."
    );
  }

  return parsed.stories;
}

/* ================================================================
   FALLBACK INTELLIGENCE
   ================================================================
 *
 * If AI is temporarily unavailable, discovery should still return
 * usable source data instead of crashing the entire dashboard.
 *
 * This fallback NEVER pretends that the story has been AI verified.
 * ================================================================ */

function createFallbackAnalysis(
  story
) {

  const sensitive =
    Boolean(story.sensitive);

  return {

    trendScore:
      sensitive ? 60 : 50,

    category:
      "other",

    priority:
      sensitive ? "high" : "medium",

    audienceRelevance:
      50,

    attentionPotential:
      50,

    humanVerificationRequired:
      true,

    confidence:
      0,

    reasoning:
      "AI analysis is currently unavailable. Story returned from source discovery only.",

    verificationReason:
      sensitive
        ? "Story contains potentially sensitive subject matter and requires human verification."
        : "AI analysis is unavailable, so the story should not be treated as automatically verified."

  };
}

/* ================================================================
   MERGE INTELLIGENCE
   ================================================================ */

function mergeAnalysis(
  stories,
  analyses
) {

  const analysisMap =
    new Map();

  for (
    const analysis of analyses
  ) {

    if (
      analysis &&
      analysis.id
    ) {

      analysisMap.set(
        String(analysis.id),
        analysis
      );

    }

  }

  return stories.map(
    (story) => {

      const ai =
        analysisMap.get(
          String(story.id)
        ) ||
        createFallbackAnalysis(
          story
        );

      const trendScore =
        clamp(
          ai.trendScore,
          0,
          100
        );

      const audienceRelevance =
        clamp(
          ai.audienceRelevance,
          0,
          100
        );

      const attentionPotential =
        clamp(
          ai.attentionPotential,
          0,
          100
        );

      const confidence =
        clamp(
          ai.confidence,
          0,
          100
        );

      /*
       * Sensitive stories always retain a verification gate.
       */
      const verificationRequired =
        story.sensitive ||
        toBoolean(
          ai.humanVerificationRequired
        ) ||
        confidence < 60;

      return {

        ...story,

        ai: {

          trendScore,

          category:
            CATEGORIES.includes(
              ai.category
            )
              ? ai.category
              : "other",

          priority:
            [
              "critical",
              "high",
              "medium",
              "low"
            ].includes(ai.priority)
              ? ai.priority
              : "medium",

          audienceRelevance,

          attentionPotential,

          humanVerificationRequired:
            verificationRequired,

          confidence,

          reasoning:
            cleanString(
              ai.reasoning
            ) ||
            "No additional AI reasoning available.",

          verificationReason:
            cleanString(
              ai.verificationReason
            ) ||
            (
              verificationRequired
                ? "Human verification required before publication."
                : "No additional verification reason supplied."
            )

        }

      };

    }
  );
}

/* ================================================================
   SORTING
   ================================================================ */

function sortStories(
  stories
) {

  return [...stories].sort(
    (a, b) => {

      const scoreA =
        Number(
          a?.ai?.trendScore
        ) || 0;

      const scoreB =
        Number(
          b?.ai?.trendScore
        ) || 0;

      return scoreB - scoreA;

    }
  );
}

/* ================================================================
   RESPONSE SUMMARY
   ================================================================ */

function buildSummary(
  stories,
  aiEnabled
) {

  const highPotential =
    stories.filter(
      (story) =>
        Number(
          story?.ai?.trendScore
        ) >= 75
    ).length;

  const criticalStories =
    stories.filter(
      (story) =>
        story?.ai?.priority ===
        "critical"
    ).length;

  const verificationRequired =
    stories.filter(
      (story) =>
        Boolean(
          story?.ai
            ?.humanVerificationRequired
        )
    ).length;

  const categories = {};

  for (
    const story of stories
  ) {

    const category =
      story?.ai?.category ||
      "other";

    categories[category] =
      (categories[category] || 0) + 1;

  }

  return {

    enabled:
      Boolean(aiEnabled),

    provider:
      aiEnabled
        ? "Google Gemini"
        : "none",

    model:
      aiEnabled
        ? GEMINI_MODEL
        : null,

    analyzed:
      Boolean(aiEnabled),

    analyzedStories:
      aiEnabled
        ? stories.length
        : 0,

    highPotential,

    criticalStories,

    verificationRequired,

    categories

  };
}

/* ================================================================
   ERROR RESPONSE
   ================================================================ */

function sendError(
  res,
  status,
  code,
  message,
  details = null
) {

  return res.status(status).json({

    success: false,

    error: {
      code,
      message,
      details:
        process.env.NODE_ENV ===
        "development"
          ? details
          : undefined
    },

    timestamp:
      new Date().toISOString()

  });
}

/* ================================================================
   MAIN HANDLER
   ================================================================ */

module.exports = async function handler(
  req,
  res
) {

  /*
   * CORS
   *
   * Useful when the frontend is served from the same Vercel project,
   * while remaining friendly to future controlled integrations.
   */
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Accept"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  /* --------------------------------------------------------------
     OPTIONS
     -------------------------------------------------------------- */

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  /* --------------------------------------------------------------
     METHOD
     -------------------------------------------------------------- */

  if (req.method !== "GET") {

    res.setHeader(
      "Allow",
      "GET, OPTIONS"
    );

    return sendError(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      "NEWSFORGE discovery endpoint accepts GET requests only."
    );

  }

  /* --------------------------------------------------------------
     ENVIRONMENT
     -------------------------------------------------------------- */

  const newsApiKey =
    cleanString(
      process.env.NEWS_API_KEY
    );

  const geminiApiKey =
    cleanString(
      process.env.GEMINI_API_KEY
    );

  if (!newsApiKey) {

    return sendError(
      res,
      500,
      "NEWS_API_KEY_MISSING",
      "NEWS_API_KEY is not configured."
    );

  }

  /* --------------------------------------------------------------
     QUERY PARAMETERS
     -------------------------------------------------------------- */

  const pageSize =
    clamp(
      req.query?.pageSize ||
        DEFAULT_PAGE_SIZE,
      1,
      MAX_PAGE_SIZE
    );

  const page =
    Math.max(
      1,
      Number(
        req.query?.page || 1
      )
    );

  /* --------------------------------------------------------------
     DISCOVERY
     -------------------------------------------------------------- */

  let discovered;

  try {

    discovered =
      await fetchNews({
        apiKey:
          newsApiKey,
        pageSize,
        page
      });

  } catch (error) {

    console.error(
      "[NEWSFORGE] Discovery error:",
      error
    );

    return sendError(
      res,
      502,
      "DISCOVERY_FAILED",
      "Unable to retrieve news from the discovery provider.",
      error?.message
    );

  }

  /* --------------------------------------------------------------
     NORMALIZATION
     -------------------------------------------------------------- */

  const stories =
    discovered.articles
      .map(
        (article, index) =>
          normalizeStory(
            article,
            index
          )
      )
      .filter(
        (story) =>
          Boolean(story.title) &&
          Boolean(story.url)
      );

  /* --------------------------------------------------------------
     AI ANALYSIS
     -------------------------------------------------------------- */

  let aiEnabled =
    Boolean(geminiApiKey);

  let analyses = [];

  if (geminiApiKey && stories.length) {

    try {

      analyses =
        await analyzeStories(
          stories,
          geminiApiKey
        );

    } catch (error) {

      /*
       * Do not destroy discovery merely because the AI layer failed.
       *
       * The response will explicitly say that AI analysis was
       * unavailable. This prevents the frontend from mistaking
       * source discovery for verified intelligence.
       */

      console.error(
        "[NEWSFORGE] Gemini analysis error:",
        error
      );

      aiEnabled = false;
      analyses = [];

    }

  } else {

    aiEnabled = false;

  }

  /* --------------------------------------------------------------
     MERGE
     -------------------------------------------------------------- */

  let enrichedStories =
    mergeAnalysis(
      stories,
      analyses
    );

  /* --------------------------------------------------------------
     SORT
     -------------------------------------------------------------- */

  enrichedStories =
    sortStories(
      enrichedStories
    );

  /* --------------------------------------------------------------
     SUMMARY
     -------------------------------------------------------------- */

  const summary =
    buildSummary(
      enrichedStories,
      aiEnabled
    );

  /* --------------------------------------------------------------
     FINAL RESPONSE
     -------------------------------------------------------------- */

  return res.status(200).json({

    success: true,

    system: {
      name: "NEWSFORGE AI",
      module: "DISCOVERY",
      version: "1.0.0",
      status: "operational",
      generatedAt:
        new Date().toISOString()
    },

    query: {
      region: "India",
      language: "en",
      sortBy: "publishedAt",
      page,
      pageSize,
      totalResults:
        discovered.totalResults
    },

    ai: summary,

    editorial: {
      publicationAllowed:
        false,

      humanApprovalRequired:
        true,

      note:
        "Discovery and AI scoring do not constitute editorial approval. Sensitive or uncertain stories require verification before publication."
    },

    stories:
      enrichedStories

  });

};
