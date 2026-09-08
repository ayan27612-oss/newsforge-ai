/**
 * NEWSFORGE AI
 * ------------------------------------------------------------
 * News Discovery + AI Intelligence Engine
 * ------------------------------------------------------------
 *
 * File:
 *   /api/news.js
 *
 * Environment variables required:
 *   NEWS_API_KEY
 *   GEMINI_API_KEY
 *
 * Runtime:
 *   Vercel Serverless Functions / Node.js
 *
 * Responsibilities:
 *   1. Fetch current news from NewsAPI
 *   2. Normalize incoming stories
 *   3. Remove duplicate stories
 *   4. Send stories to Gemini
 *   5. Generate structured intelligence
 *   6. Calculate / validate editorial signals
 *   7. Return frontend-ready JSON
 *
 * IMPORTANT:
 *   This module does NOT publish anything.
 *   It only discovers and analyzes news.
 *
 * ------------------------------------------------------------
 */

"use strict";

/* ============================================================
   CONFIGURATION
   ============================================================ */

const CONFIG = {
  NEWS_API_URL: "https://newsapi.org/v2/everything",

  GEMINI_API_URL:
    "https://generativelanguage.googleapis.com/v1beta/interactions",

  GEMINI_MODEL: "gemini-3.6-flash",

  DEFAULT_PAGE_SIZE: 20,
  MAX_PAGE_SIZE: 50,

  NEWS_LANGUAGE: "en",
  NEWS_SORT_BY: "publishedAt",

  REQUEST_TIMEOUT_MS: 25000,
  GEMINI_TIMEOUT_MS: 45000,

  MAX_ARTICLE_TEXT: 4500,
  MAX_DESCRIPTION_LENGTH: 1800,
  MAX_TITLE_LENGTH: 500,

  CACHE_CONTROL:
    "s-maxage=300, stale-while-revalidate=600",

  CORS_ORIGIN: "*"
};


/* ============================================================
   CATEGORY DEFINITIONS
   ============================================================ */

const CATEGORY_KEYWORDS = {
  politics: [
    "government",
    "minister",
    "prime minister",
    "president",
    "election",
    "parliament",
    "lok sabha",
    "rajya sabha",
    "political",
    "politics",
    "policy",
    "cabinet",
    "bjp",
    "congress",
    "party",
    "vote",
    "voting",
    "chief minister",
    "mps",
    "mla"
  ],

  business: [
    "company",
    "business",
    "startup",
    "corporate",
    "revenue",
    "profit",
    "loss",
    "investment",
    "investor",
    "market",
    "stock",
    "stocks",
    "share",
    "shares",
    "ipo",
    "acquisition",
    "merger",
    "funding",
    "valuation",
    "economy",
    "economic"
  ],

  finance: [
    "bank",
    "banking",
    "rbi",
    "interest rate",
    "inflation",
    "rupee",
    "dollar",
    "currency",
    "forex",
    "bond",
    "tax",
    "gst",
    "loan",
    "credit",
    "financial",
    "finance"
  ],

  technology: [
    "ai",
    "artificial intelligence",
    "technology",
    "tech",
    "software",
    "hardware",
    "chip",
    "semiconductor",
    "robot",
    "robotics",
    "cyber",
    "cybersecurity",
    "google",
    "microsoft",
    "apple",
    "meta",
    "openai",
    "nvidia",
    "cloud",
    "data center"
  ],

  science: [
    "science",
    "scientist",
    "research",
    "space",
    "nasa",
    "isro",
    "rocket",
    "satellite",
    "astronomy",
    "physics",
    "biology",
    "climate",
    "discovery"
  ],

  health: [
    "health",
    "healthcare",
    "hospital",
    "doctor",
    "medical",
    "medicine",
    "disease",
    "virus",
    "vaccine",
    "treatment",
    "drug",
    "cancer",
    "clinical"
  ],

  sports: [
    "cricket",
    "football",
    "soccer",
    "tennis",
    "hockey",
    "olympics",
    "sports",
    "match",
    "tournament",
    "player",
    "team",
    "league",
    "ipl",
    "fifa"
  ],

  world: [
    "international",
    "global",
    "united states",
    "america",
    "china",
    "russia",
    "ukraine",
    "europe",
    "middle east",
    "israel",
    "iran",
    "united nations",
    "foreign",
    "war",
    "conflict"
  ],

  entertainment: [
    "movie",
    "film",
    "actor",
    "actress",
    "bollywood",
    "hollywood",
    "music",
    "celebrity",
    "netflix",
    "series",
    "television",
    "streaming"
  ],

  lifestyle: [
    "lifestyle",
    "travel",
    "food",
    "fashion",
    "culture",
    "festival",
    "education",
    "career",
    "jobs",
    "consumer"
  ]
};


/* ============================================================
   HTTP HELPERS
   ============================================================ */

/**
 * Creates a standard JSON response.
 */
function sendJson(res, statusCode, payload) {
  res.status(statusCode);

  res.setHeader(
    "Content-Type",
    "application/json; charset=utf-8"
  );

  res.setHeader(
    "Cache-Control",
    CONFIG.CACHE_CONTROL
  );

  res.setHeader(
    "Access-Control-Allow-Origin",
    CONFIG.CORS_ORIGIN
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type"
  );

  return res.json(payload);
}


/**
 * Creates a consistent error payload.
 */
function sendError(
  res,
  statusCode,
  code,
  message,
  details = null
) {
  return sendJson(res, statusCode, {
    success: false,

    error: {
      code,
      message,
      details
    },

    timestamp: new Date().toISOString()
  });
}


/**
 * Fetch with timeout.
 */
async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = CONFIG.REQUEST_TIMEOUT_MS
) {
  const controller = new AbortController();

  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}


/* ============================================================
   GENERAL UTILITY FUNCTIONS
   ============================================================ */

/**
 * Safely convert any value to a string.
 */
function safeString(value, fallback = "") {
  if (value === null || value === undefined) {
    return fallback;
  }

  return String(value).trim();
}


/**
 * Clamp a numeric value between min and max.
 */
function clamp(value, min = 0, max = 100) {
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
 * Convert an unknown value to an integer score.
 */
function score(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return Math.round(
    clamp(number, 0, 100)
  );
}


/**
 * Normalize text.
 */
function normalizeText(value) {
  return safeString(value)
    .replace(/\s+/g, " ")
    .trim();
}


/**
 * Create a normalized key for duplicate detection.
 */
function normalizeKey(value) {
  return normalizeText(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}


/**
 * Create a simple deterministic hash.
 *
 * This is not cryptography.
 * It is only used for internal deduplication.
 */
function simpleHash(input) {
  const text = safeString(input);

  let hash = 0;

  for (let i = 0; i < text.length; i++) {
    hash =
      (hash << 5) -
      hash +
      text.charCodeAt(i);

    hash |= 0;
  }

  return Math.abs(hash).toString(36);
}


/**
 * Parse a date safely.
 */
function safeDate(value) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}


/**
 * Convert date to ISO.
 */
function toISODate(value) {
  const date = safeDate(value);

  if (!date) {
    return null;
  }

  return date.toISOString();
}


/* ============================================================
   CATEGORY DETECTION
   ============================================================ */

/**
 * Detect category locally.
 *
 * Gemini remains the primary intelligence layer.
 * This function acts as a fallback and consistency check.
 */
function detectCategoryLocally(article) {
  const text = [
    article.title,
    article.description,
    article.content,
    article.source?.name
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();

  const scores = {};

  for (const [category, keywords] of Object.entries(
    CATEGORY_KEYWORDS
  )) {
    let points = 0;

    for (const keyword of keywords) {
      if (text.includes(keyword)) {
        points += 1;
      }
    }

    scores[category] = points;
  }

  let winner = "general";
  let highest = 0;

  for (const [category, points] of Object.entries(scores)) {
    if (points > highest) {
      highest = points;
      winner = category;
    }
  }

  return winner;
}


/* ============================================================
   ARTICLE NORMALIZATION
   ============================================================ */

/**
 * Normalize a NewsAPI article into NEWSFORGE format.
 */
function normalizeArticle(article, index = 0) {
  const sourceName =
    safeString(article?.source?.name) ||
    "Unknown Source";

  const sourceId =
    safeString(article?.source?.id);

  const title =
    normalizeText(article?.title) ||
    "Untitled story";

  const description =
    normalizeText(article?.description);

  const content =
    normalizeText(article?.content);

  const url =
    safeString(article?.url);

  const image =
    safeString(article?.urlToImage);

  const publishedAt =
    toISODate(article?.publishedAt);

  const author =
    normalizeText(article?.author);

  const localCategory =
    detectCategoryLocally({
      title,
      description,
      content,
      source: {
        name: sourceName
      }
    });

  const identityBase = [
    normalizeKey(title),
    normalizeKey(sourceName)
  ].join("|");

  return {
    id:
      `story-${simpleHash(identityBase)}-${index}`,

    source: {
      id: sourceId || null,
      name: sourceName
    },

    author: author || null,

    title:
      title.slice(
        0,
        CONFIG.MAX_TITLE_LENGTH
      ),

    description:
      description.slice(
        0,
        CONFIG.MAX_DESCRIPTION_LENGTH
      ),

    content:
      content.slice(
        0,
        CONFIG.MAX_ARTICLE_TEXT
      ),

    url: url || null,

    image: image || null,

    publishedAt,

    category: localCategory,

    ai: null,

    metadata: {
      discoveryIndex: index,
      normalizedAt: new Date().toISOString()
    }
  };
}


/* ============================================================
   DUPLICATE FILTERING
   ============================================================ */

/**
 * Remove duplicate articles.
 *
 * We compare:
 *   - exact URL
 *   - normalized title
 *   - normalized title + source
 */
function deduplicateArticles(articles) {
  const seenUrls = new Set();
  const seenTitles = new Set();
  const seenIdentity = new Set();

  const unique = [];

  for (const article of articles) {
    const url =
      normalizeKey(article.url);

    const title =
      normalizeKey(article.title);

    const identity =
      `${title}|${normalizeKey(
        article.source?.name
      )}`;

    if (url && seenUrls.has(url)) {
      continue;
    }

    if (title && seenTitles.has(title)) {
      continue;
    }

    if (seenIdentity.has(identity)) {
      continue;
    }

    if (url) {
      seenUrls.add(url);
    }

    if (title) {
      seenTitles.add(title);
    }

    seenIdentity.add(identity);

    unique.push(article);
  }

  return unique;
}


/* ============================================================
   NEWSAPI QUERY
   ============================================================ */

/**
 * Build the default India-focused search query.
 *
 * The query intentionally includes several major domains
 * because NEWSFORGE is designed as a broad intelligence layer,
 * not merely a politics dashboard.
 */
function buildNewsQuery(customQuery = "") {
  const supplied =
    normalizeText(customQuery);

  if (supplied) {
    return supplied;
  }

  return [
    "India",
    "Indian government",
    "Indian economy",
    "Indian business",
    "Indian markets",
    "India technology",
    "India finance",
    "India startup",
    "India policy",
    "India geopolitics"
  ].join(" OR ");
}


/**
 * Fetch articles from NewsAPI.
 */
async function fetchNewsFromNewsAPI({
  pageSize,
  page = 1,
  query = ""
}) {
  const apiKey =
    process.env.NEWS_API_KEY;

  if (!apiKey) {
    throw new Error(
      "NEWS_API_KEY is not configured in Vercel environment variables."
    );
  }

  const finalPageSize =
    Math.min(
      CONFIG.MAX_PAGE_SIZE,
      Math.max(
        1,
        Number(pageSize) ||
          CONFIG.DEFAULT_PAGE_SIZE
      )
    );

  const finalPage =
    Math.max(
      1,
      Number(page) || 1
    );

  const finalQuery =
    buildNewsQuery(query);

  const params =
    new URLSearchParams();

  params.set(
    "q",
    finalQuery
  );

  params.set(
    "language",
    CONFIG.NEWS_LANGUAGE
  );

  params.set(
    "sortBy",
    CONFIG.NEWS_SORT_BY
  );

  params.set(
    "pageSize",
    String(finalPageSize)
  );

  params.set(
    "page",
    String(finalPage)
  );

  params.set(
    "apiKey",
    apiKey
  );

  const url =
    `${CONFIG.NEWS_API_URL}?${params.toString()}`;

  let response;

  try {
    response =
      await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept:
              "application/json"
          }
        },
        CONFIG.REQUEST_TIMEOUT_MS
      );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "NewsAPI request timed out."
      );
    }

    throw new Error(
      `NewsAPI network request failed: ${
        error?.message ||
        "Unknown network error"
      }`
    );
  }

  let data;

  try {
    data = await response.json();
  } catch {
    throw new Error(
      `NewsAPI returned an invalid JSON response. HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    throw new Error(
      data?.message ||
      `NewsAPI request failed with HTTP ${response.status}.`
    );
  }

  if (
    data?.status &&
    data.status !== "ok"
  ) {
    throw new Error(
      data?.message ||
      "NewsAPI returned an unsuccessful response."
    );
  }

  return {
    articles:
      Array.isArray(data?.articles)
        ? data.articles
        : [],

    totalResults:
      Number(data?.totalResults) || 0
  };
}


/* ============================================================
   GEMINI PROMPT
   ============================================================ */

/**
 * Build the AI intelligence prompt.
 */
function buildGeminiPrompt(articles) {
  const serialized =
    articles.map((article, index) => {
      return {
        index,

        source:
          article.source?.name ||
          "Unknown",

        author:
          article.author ||
          null,

        title:
          article.title,

        description:
          article.description,

        content:
          article.content,

        publishedAt:
          article.publishedAt,

        url:
          article.url
      };
    });

  return `
You are the intelligence engine of NEWSFORGE AI.

NEWSFORGE is a professional news discovery and editorial
intelligence platform focused primarily on India while
monitoring globally relevant developments.

Your job is NOT to invent facts.

You are analyzing the supplied news stories and must return
structured editorial intelligence.

IMPORTANT EDITORIAL RULES:

1. Never invent information.
2. Never assume an allegation is proven.
3. Never state a death, arrest, crime, disaster, political
   allegation, medical claim, financial claim or major event
   as confirmed unless the supplied information supports it.
4. If a story requires additional verification, set
   humanVerificationRequired to true.
5. Breaking news should normally require human verification.
6. Politics, elections, communal issues, deaths, disasters,
   allegations, medical claims and market-sensitive stories
   should receive additional caution.
7. Trend score is NOT a truth score.
8. Attention potential is NOT a credibility score.
9. A story can be highly interesting while still requiring
   verification.
10. Keep reasoning concise but useful for an editor.
11. Use only information present in the supplied articles.
12. Do not fabricate sources.
13. Do not fabricate quotes.
14. Do not fabricate numbers.
15. Do not fabricate events.
16. If information is insufficient, explicitly say so.

SCORING:

trendScore:
0-100 estimate of how likely the story is currently
important, timely or widely interesting.

audienceRelevance:
0-100 relevance to an Indian/general digital audience.

attentionPotential:
0-100 likelihood of attracting attention.

confidence:
0-100 confidence in the classification based ONLY on the
supplied article information.

PRIORITY:

critical:
Potentially immediate/high-impact development.

high:
Important and potentially significant.

medium:
Worth monitoring or publishing depending on editorial value.

low:
Lower urgency.

CATEGORIES:

politics
business
finance
technology
science
health
sports
world
entertainment
lifestyle
general

VERIFICATION:

humanVerificationRequired should be true when:
- facts appear incomplete,
- story is breaking,
- claims are allegations,
- source information is insufficient,
- story could materially affect people,
- story concerns deaths/disasters/crime,
- story concerns elections or politics,
- story contains potentially market-moving information,
- medical/scientific claims need confirmation.

Return ONLY valid JSON matching the requested schema.

INPUT ARTICLES:

${JSON.stringify(serialized, null, 2)}
`;
}


/* ============================================================
   GEMINI SCHEMA
   ============================================================ */

function getGeminiSchema() {
  return {
    type: "object",

    properties: {
      stories: {
        type: "array",

        items: {
          type: "object",

          properties: {
            index: {
              type: "integer"
            },

            trendScore: {
              type: "integer"
            },

            category: {
              type: "string"
            },

            priority: {
              type: "string"
            },

            audienceRelevance: {
              type: "integer"
            },

            attentionPotential: {
              type: "integer"
            },

            confidence: {
              type: "integer"
            },

            humanVerificationRequired: {
              type: "boolean"
            },

            verificationReason: {
              type: "string"
            },

            reasoning: {
              type: "string"
            },

            editorialAngle: {
              type: "string"
            }
          },

          required: [
            "index",
            "trendScore",
            "category",
            "priority",
            "audienceRelevance",
            "attentionPotential",
            "confidence",
            "humanVerificationRequired",
            "verificationReason",
            "reasoning",
            "editorialAngle"
          ]
        }
      }
    },

    required: [
      "stories"
    ]
  };
}


/* ============================================================
   GEMINI RESPONSE EXTRACTION
   ============================================================ */

/**
 * Extract text from Gemini Interactions API response.
 *
 * Gemini Interactions responses can contain multiple steps.
 * We search backwards for model output text because that is
 * the most useful final representation.
 */
function extractGeminiText(response) {
  if (!response) {
    return "";
  }

  const candidates = [];

  if (
    Array.isArray(
      response.steps
    )
  ) {
    for (
      let i = response.steps.length - 1;
      i >= 0;
      i--
    ) {
      const step =
        response.steps[i];

      if (
        Array.isArray(step?.content)
      ) {
        for (
          let j = step.content.length - 1;
          j >= 0;
          j--
        ) {
          const content =
            step.content[j];

          if (
            typeof content?.text ===
            "string"
          ) {
            candidates.push(
              content.text
            );
          }
        }
      }
    }
  }

  if (
    typeof response.output_text ===
    "string"
  ) {
    candidates.push(
      response.output_text
    );
  }

  if (
    typeof response.text ===
    "string"
  ) {
    candidates.push(
      response.text
    );
  }

  if (
    Array.isArray(
      response.outputs
    )
  ) {
    for (
      let i = response.outputs.length - 1;
      i >= 0;
      i--
    ) {
      const output =
        response.outputs[i];

      if (
        typeof output?.text ===
        "string"
      ) {
        candidates.push(
          output.text
        );
      }

      if (
        Array.isArray(
          output?.content
        )
      ) {
        for (
          const content of output.content
        ) {
          if (
            typeof content?.text ===
            "string"
          ) {
            candidates.push(
              content.text
            );
          }
        }
      }
    }
  }

  return (
    candidates
      .map(normalizeText)
      .filter(Boolean)
      .sort(
        (a, b) =>
          b.length - a.length
      )[0] ||
    ""
  );
}


/**
 * Remove accidental markdown fences from AI output.
 */
function cleanJsonText(text) {
  let cleaned =
    safeString(text);

  cleaned =
    cleaned.replace(
      /^```json\s*/i,
      ""
    );

  cleaned =
    cleaned.replace(
      /^```\s*/i,
      ""
    );

  cleaned =
    cleaned.replace(
      /\s*```$/i,
      ""
    );

  return cleaned.trim();
}


/**
 * Parse Gemini JSON safely.
 */
function parseGeminiJson(text) {
  const cleaned =
    cleanJsonText(text);

  if (!cleaned) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  try {
    return JSON.parse(cleaned);
  } catch {
    /*
     * Sometimes a model may surround valid JSON with
     * additional text despite structured-output instructions.
     * Try extracting the first JSON object.
     */

    const firstBrace =
      cleaned.indexOf("{");

    const lastBrace =
      cleaned.lastIndexOf("}");

    if (
      firstBrace >= 0 &&
      lastBrace > firstBrace
    ) {
      const candidate =
        cleaned.slice(
          firstBrace,
          lastBrace + 1
        );

      try {
        return JSON.parse(candidate);
      } catch {
        // Continue to final error.
      }
    }

    throw new Error(
      "Gemini returned malformed JSON."
    );
  }
}


/* ============================================================
   GEMINI ANALYSIS
   ============================================================ */

/**
 * Analyze articles with Gemini.
 */
async function analyzeWithGemini(
  articles
) {
  const apiKey =
    process.env.GEMINI_API_KEY;

  if (!apiKey) {
    throw new Error(
      "GEMINI_API_KEY is not configured in Vercel environment variables."
    );
  }

  if (!articles.length) {
    return {
      stories: []
    };
  }

  const prompt =
    buildGeminiPrompt(
      articles
    );

  const body = {
    model:
      CONFIG.GEMINI_MODEL,

    input: prompt,

    response_format: {
      type: "text",

      mime_type:
        "application/json",

      schema:
        getGeminiSchema()
    }
  };

  let response;

  try {
    response =
      await fetchWithTimeout(
        CONFIG.GEMINI_API_URL,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              apiKey,

            Accept:
              "application/json"
          },

          body:
            JSON.stringify(body)
        },
        CONFIG.GEMINI_TIMEOUT_MS
      );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Gemini request timed out."
      );
    }

    throw new Error(
      `Gemini network request failed: ${
        error?.message ||
        "Unknown network error"
      }`
    );
  }

  let data;

  try {
    data =
      await response.json();
  } catch {
    throw new Error(
      `Gemini returned invalid JSON. HTTP ${response.status}.`
    );
  }

  if (!response.ok) {
    const providerMessage =
      data?.error?.message ||
      data?.message ||
      `HTTP ${response.status}`;

    throw new Error(
      `Gemini API error: ${providerMessage}`
    );
  }

  const text =
    extractGeminiText(data);

  if (!text) {
    throw new Error(
      "Gemini completed the request but returned no model output."
    );
  }

  const parsed =
    parseGeminiJson(text);

  if (
    !parsed ||
    !Array.isArray(
      parsed.stories
    )
  ) {
    throw new Error(
      "Gemini response did not contain a valid stories array."
    );
  }

  return parsed;
}


/* ============================================================
   AI DATA NORMALIZATION
   ============================================================ */

/**
 * Normalize one AI result.
 */
function normalizeAIResult(
  ai,
  article
) {
  const category =
    safeString(
      ai?.category
    ).toLowerCase();

  const allowedCategories =
    new Set([
      "politics",
      "business",
      "finance",
      "technology",
      "science",
      "health",
      "sports",
      "world",
      "entertainment",
      "lifestyle",
      "general"
    ]);

  const finalCategory =
    allowedCategories.has(
      category
    )
      ? category
      : (
          article.category ||
          "general"
        );

  const priority =
    safeString(
      ai?.priority
    ).toLowerCase();

  const allowedPriorities =
    new Set([
      "critical",
      "high",
      "medium",
      "low"
    ]);

  const finalPriority =
    allowedPriorities.has(
      priority
    )
      ? priority
      : "medium";

  const verification =
    Boolean(
      ai?.humanVerificationRequired
    );

  return {
    trendScore:
      score(
        ai?.trendScore,
        50
      ),

    category:
      finalCategory,

    priority:
      finalPriority,

    audienceRelevance:
      score(
        ai?.audienceRelevance,
        50
      ),

    attentionPotential:
      score(
        ai?.attentionPotential,
        50
      ),

    confidence:
      score(
        ai?.confidence,
        40
      ),

    humanVerificationRequired:
      verification,

    verificationReason:
      normalizeText(
        ai?.verificationReason
      ) ||
      (
        verification
          ? "Additional human verification is recommended."
          : "No additional verification flag was generated."
      ),

    reasoning:
      normalizeText(
        ai?.reasoning
      ) ||
      "No AI reasoning was returned.",

    editorialAngle:
      normalizeText(
        ai?.editorialAngle
      ) ||
      "Monitor story development."
  };
}


/**
 * Apply AI results to articles.
 */
function attachAIResults(
  articles,
  analysis
) {
  const aiStories =
    Array.isArray(
      analysis?.stories
    )
      ? analysis.stories
      : [];

  const aiByIndex =
    new Map();

  for (
    const result of aiStories
  ) {
    const index =
      Number(result?.index);

    if (
      Number.isInteger(index)
    ) {
      aiByIndex.set(
        index,
        result
      );
    }
  }

  return articles.map(
    (article, index) => {
      const ai =
        aiByIndex.get(index);

      if (!ai) {
        return {
          ...article,

          ai: {
            trendScore: 35,

            category:
              article.category ||
              "general",

            priority: "medium",

            audienceRelevance: 35,

            attentionPotential: 35,

            confidence: 20,

            humanVerificationRequired:
              true,

            verificationReason:
              "AI analysis was unavailable for this story. Manual review is required.",

            reasoning:
              "The intelligence engine did not return an analysis for this story.",

            editorialAngle:
              "Manual editorial review required.",

            analyzed:
              false
          }
        };
      }

      return {
        ...article,

        category:
          normalizeAIResult(
            ai,
            article
          ).category,

        ai: {
          ...normalizeAIResult(
            ai,
            article
          ),

          analyzed:
            true
        }
      };
    }
  );
}


/* ============================================================
   EDITORIAL SAFETY NORMALIZATION
   ============================================================ */

/**
 * Force human verification for certain categories / signals.
 *
 * This is deliberately conservative.
 */
function applyEditorialSafety(
  articles
) {
  const sensitiveCategories =
    new Set([
      "politics",
      "health"
    ]);

  return articles.map(
    article => {
      const ai =
        article.ai || {};

      let requiresReview =
        Boolean(
          ai.humanVerificationRequired
        );

      let reason =
        ai.verificationReason ||
        "";

      if (
        sensitiveCategories.has(
          ai.category
        ) &&
        ai.confidence < 70
      ) {
        requiresReview = true;

        reason =
          "Sensitive category with limited AI confidence. Human verification is required.";
      }

      if (
        ai.priority === "critical"
      ) {
        requiresReview = true;

        reason =
          "Critical-priority story requires human editorial approval before publication.";
      }

      if (
        ai.trendScore >= 90 &&
        ai.confidence < 75
      ) {
        requiresReview = true;

        reason =
          "High-trend story with insufficient confidence requires verification.";
      }

      return {
        ...article,

        ai: {
          ...ai,

          humanVerificationRequired:
            requiresReview,

          verificationReason:
            reason ||
            (
              requiresReview
                ? "Human verification required."
                : "No mandatory verification flag."
            )
        }
      };
    }
  );
}


/* ============================================================
   SORTING
   ============================================================ */

/**
 * Sort stories by editorial importance.
 *
 * Primary:
 *   trend score
 *
 * Secondary:
 *   attention potential
 *
 * Tertiary:
 *   publication date
 */
function sortByImportance(
  articles
) {
  return [...articles].sort(
    (a, b) => {
      const aTrend =
        Number(
          a.ai?.trendScore
        ) || 0;

      const bTrend =
        Number(
          b.ai?.trendScore
        ) || 0;

      if (
        bTrend !== aTrend
      ) {
        return (
          bTrend - aTrend
        );
      }

      const aAttention =
        Number(
          a.ai?.attentionPotential
        ) || 0;

      const bAttention =
        Number(
          b.ai?.attentionPotential
        ) || 0;

      if (
        bAttention !==
        aAttention
      ) {
        return (
          bAttention -
          aAttention
        );
      }

      const aDate =
        safeDate(
          a.publishedAt
        )?.getTime() || 0;

      const bDate =
        safeDate(
          b.publishedAt
        )?.getTime() || 0;

      return (
        bDate - aDate
      );
    }
  );
}


/* ============================================================
   INTELLIGENCE SUMMARY
   ============================================================ */

/**
 * Build dashboard-level intelligence metrics.
 */
function buildIntelligenceSummary(
  articles
) {
  const analyzed =
    articles.filter(
      article =>
        article.ai?.analyzed
    );

  const highPotential =
    articles.filter(
      article =>
        Number(
          article.ai?.trendScore
        ) >= 75
    );

  const criticalStories =
    articles.filter(
      article =>
        article.ai?.priority ===
        "critical"
    );

  const verificationRequired =
    articles.filter(
      article =>
        article.ai?.humanVerificationRequired
    );

  const averageTrend =
    analyzed.length
      ? Math.round(
          analyzed.reduce(
            (sum, article) =>
              sum +
              (
                Number(
                  article.ai?.trendScore
                ) || 0
              ),
            0
          ) /
          analyzed.length
        )
      : 0;

  const categories = {};

  for (
    const article of articles
  ) {
    const category =
      article.ai?.category ||
      article.category ||
      "general";

    categories[category] =
      (
        categories[category] ||
        0
      ) + 1;
  }

  return {
    totalStories:
      articles.length,

    analyzedStories:
      analyzed.length,

    highPotential:
      highPotential.length,

    criticalStories:
      criticalStories.length,

    verificationRequired:
      verificationRequired.length,

    averageTrendScore:
      averageTrend,

    categories
  };
}


/* ============================================================
   REQUEST PARAMETER PARSING
   ============================================================ */

/**
 * Parse incoming query parameters.
 */
function parseQueryParams(req) {
  const query =
    req?.query || {};

  const pageSize =
    Number(
      query.pageSize
    ) ||
    CONFIG.DEFAULT_PAGE_SIZE;

  const page =
    Number(
      query.page
    ) || 1;

  const customQuery =
    safeString(
      query.q ||
      query.query
    );

  return {
    pageSize:
      Math.min(
        CONFIG.MAX_PAGE_SIZE,
        Math.max(
          1,
          pageSize
        )
      ),

    page:
      Math.max(
        1,
        page
      ),

    query:
      customQuery
  };
}


/* ============================================================
   MAIN HANDLER
   ============================================================ */

export default async function handler(
  req,
  res
) {
  const requestStarted =
    Date.now();

  /* ----------------------------------------------------------
     CORS / OPTIONS
     ---------------------------------------------------------- */

  if (
    req.method ===
    "OPTIONS"
  ) {
    res.status(204);

    res.setHeader(
      "Access-Control-Allow-Origin",
      CONFIG.CORS_ORIGIN
    );

    res.setHeader(
      "Access-Control-Allow-Methods",
      "GET, OPTIONS"
    );

    res.setHeader(
      "Access-Control-Allow-Headers",
      "Content-Type"
    );

    return res.end();
  }


  /* ----------------------------------------------------------
     METHOD CHECK
     ---------------------------------------------------------- */

  if (
    req.method !== "GET"
  ) {
    return sendError(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      "Only GET requests are supported by the news discovery endpoint."
    );
  }


  /* ----------------------------------------------------------
     ENVIRONMENT CHECK
     ---------------------------------------------------------- */

  const missingKeys = [];

  if (
    !process.env.NEWS_API_KEY
  ) {
    missingKeys.push(
      "NEWS_API_KEY"
    );
  }

  if (
    !process.env.GEMINI_API_KEY
  ) {
    missingKeys.push(
      "GEMINI_API_KEY"
    );
  }

  if (
    missingKeys.length
  ) {
    return sendError(
      res,
      500,
      "CONFIGURATION_ERROR",
      "NEWSFORGE backend is missing required environment variables.",
      {
        missing:
          missingKeys
      }
    );
  }


  /* ----------------------------------------------------------
     PARSE QUERY
     ---------------------------------------------------------- */

  const {
    pageSize,
    page,
    query
  } =
    parseQueryParams(req);


  /* ----------------------------------------------------------
     DISCOVERY
     ---------------------------------------------------------- */

  let rawNews;

  try {
    rawNews =
      await fetchNewsFromNewsAPI({
        pageSize,
        page,
        query
      });
  } catch (error) {
    console.error(
      "[NEWSFORGE][NEWSAPI]",
      error
    );

    return sendError(
      res,
      502,
      "NEWS_PROVIDER_ERROR",
      "Unable to retrieve news from the external news provider.",
      {
        message:
          error?.message ||
          "Unknown NewsAPI error."
      }
    );
  }


  /* ----------------------------------------------------------
     NORMALIZE
     ---------------------------------------------------------- */

  let articles =
    rawNews.articles.map(
      (article, index) =>
        normalizeArticle(
          article,
          index
        )
    );


  /* ----------------------------------------------------------
     DEDUPLICATE
     ---------------------------------------------------------- */

  articles =
    deduplicateArticles(
      articles
    );


  /* ----------------------------------------------------------
     EMPTY RESULT
     ---------------------------------------------------------- */

  if (!articles.length) {
    return sendJson(
      res,
      200,
      {
        success: true,

        stories: [],

        articles: [],

        totalResults:
          rawNews.totalResults,

        ai: {
          enabled: true,

          provider:
            "Google Gemini",

          model:
            CONFIG.GEMINI_MODEL,

          analyzed: 0,

          analyzedStories: 0,

          highPotential: 0,

          criticalStories: 0,

          verificationRequired: 0
        },

        intelligence:
          buildIntelligenceSummary(
            []
          ),

        meta: {
          query:
            buildNewsQuery(
              query
            ),

          page,

          pageSize,

          fetched:
            rawNews.articles.length,

          unique:
            0,

          durationMs:
            Date.now() -
            requestStarted,

          generatedAt:
            new Date().toISOString()
        }
      }
    );
  }


  /* ----------------------------------------------------------
     AI ANALYSIS
     ---------------------------------------------------------- */

  let aiAnalysis;

  try {
    aiAnalysis =
      await analyzeWithGemini(
        articles
      );
  } catch (error) {
    console.error(
      "[NEWSFORGE][GEMINI]",
      error
    );

    /*
     * IMPORTANT:
     *
     * We do NOT destroy the entire news response when Gemini
     * fails.
     *
     * The dashboard still receives the discovered stories,
     * but every story is explicitly marked as requiring
     * human review.
     */

    articles =
      articles.map(
        article => ({
          ...article,

          ai: {
            trendScore: 0,

            category:
              article.category ||
              "general",

            priority:
              "medium",

            audienceRelevance:
              0,

            attentionPotential:
              0,

            confidence:
              0,

            humanVerificationRequired:
              true,

            verificationReason:
              "AI intelligence analysis failed. Manual editorial review is required.",

            reasoning:
              "The news provider returned the story, but the AI analysis layer was unavailable.",

            editorialAngle:
              "Do not automatically publish. Review the original source manually.",

            analyzed:
              false
          }
        })
      );

    return sendJson(
      res,
      200,
      {
        success: true,

        stories:
          articles,

        articles:
          articles,

        totalResults:
          rawNews.totalResults,

        ai: {
          enabled: true,

          provider:
            "Google Gemini",

          model:
            CONFIG.GEMINI_MODEL,

          analyzed: 0,

          analyzedStories: 0,

          highPotential: 0,

          criticalStories: 0,

          verificationRequired:
            articles.length,

          failed: true,

          error:
            "AI analysis unavailable."
        },

        intelligence:
          buildIntelligenceSummary(
            articles
          ),

        meta: {
          query:
            buildNewsQuery(
              query
            ),

          page,

          pageSize,

          fetched:
            rawNews.articles.length,

          unique:
            articles.length,

          durationMs:
            Date.now() -
            requestStarted,

          generatedAt:
            new Date().toISOString()
        }
      }
    );
  }


  /* ----------------------------------------------------------
     ATTACH AI RESULTS
     ---------------------------------------------------------- */

  articles =
    attachAIResults(
      articles,
      aiAnalysis
    );


  /* ----------------------------------------------------------
     EDITORIAL SAFETY
     ---------------------------------------------------------- */

  articles =
    applyEditorialSafety(
      articles
    );


  /* ----------------------------------------------------------
     SORT
     ---------------------------------------------------------- */

  articles =
    sortByImportance(
      articles
    );


  /* ----------------------------------------------------------
     SUMMARY
     ---------------------------------------------------------- */

  const intelligence =
    buildIntelligenceSummary(
      articles
    );


  /* ----------------------------------------------------------
     FINAL RESPONSE
     ---------------------------------------------------------- */

  return sendJson(
    res,
    200,
    {
      success: true,

      stories:
        articles,

      /*
       * Keep both names.
       *
       * "stories" is the canonical NEWSFORGE structure.
       * "articles" preserves compatibility with older frontend
       * versions.
       */
      articles:
        articles,

      totalResults:
        rawNews.totalResults,

      ai: {
        enabled: true,

        provider:
          "Google Gemini",

        model:
          CONFIG.GEMINI_MODEL,

        analyzed:
          intelligence.analyzedStories > 0,

        analyzedStories:
          intelligence.analyzedStories,

        highPotential:
          intelligence.highPotential,

        criticalStories:
          intelligence.criticalStories,

        verificationRequired:
          intelligence.verificationRequired
      },

      intelligence,

      meta: {
        query:
          buildNewsQuery(
            query
          ),

        page,

        pageSize,

        fetched:
          rawNews.articles.length,

        unique:
          articles.length,

        durationMs:
          Date.now() -
          requestStarted,

        generatedAt:
          new Date().toISOString()
      }
    }
  );
}
