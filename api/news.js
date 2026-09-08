// NEWSFORGE AI
// News Discovery + AI Trend Intelligence Engine
// api/news.js

const NEWS_API_KEY = process.env.NEWS_API_KEY;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const GEMINI_MODEL =
  process.env.GEMINI_MODEL || "gemini-3.6-flash";

const NEWS_API_URL =
  "https://newsapi.org/v2/everything";

const GEMINI_URL =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

/* =========================================================
   HELPERS
========================================================= */

function cleanText(value, maxLength = 5000) {
  if (value === null || value === undefined) return "";

  return String(value)
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function clamp(value, min = 0, max = 100) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.max(min, Math.min(max, number));
}

function normalizeScore(value) {
  return Math.round(clamp(value, 0, 100));
}

function normalizePriority(value) {
  const priority = cleanText(value, 50).toUpperCase();

  if (["CRITICAL", "HIGH", "MEDIUM", "LOW"].includes(priority)) {
    return priority;
  }

  return "MEDIUM";
}

function normalizeCategory(value) {
  const category = cleanText(value, 100).toUpperCase();

  const allowed = [
    "POLITICS",
    "BUSINESS",
    "TECHNOLOGY",
    "SCIENCE",
    "HEALTH",
    "SPORTS",
    "ENTERTAINMENT",
    "WORLD",
    "INDIA",
    "CLIMATE",
    "SECURITY",
    "OTHER"
  ];

  return allowed.includes(category)
    ? category
    : "OTHER";
}

function uniqueArticles(articles) {
  const seen = new Set();

  return safeArray(articles).filter(article => {
    const key =
      article.url ||
      `${article.title}:${article.publishedAt}`;

    if (!key) return false;

    if (seen.has(key)) return false;

    seen.add(key);

    return true;
  });
}

/* =========================================================
   HTTP
========================================================= */

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
      data?.message ||
      data?.error?.message ||
      `HTTP ${response.status}`
    );

    error.status = response.status;
    error.response = data;

    throw error;
  }

  return data;
}

/* =========================================================
   ARTICLE NORMALIZATION
========================================================= */

function normalizeArticle(article) {
  if (!article || typeof article !== "object") {
    return null;
  }

  return {
    source: {
      id: cleanText(
        article.source?.id,
        200
      ),

      name:
        cleanText(
          article.source?.name,
          300
        ) || "Unknown Source"
    },

    author: cleanText(
      article.author,
      500
    ),

    title: cleanText(
      article.title,
      1000
    ),

    description: cleanText(
      article.description,
      3000
    ),

    url: cleanText(
      article.url,
      3000
    ),

    image: cleanText(
      article.urlToImage,
      3000
    ),

    publishedAt: cleanText(
      article.publishedAt,
      200
    ),

    content: cleanText(
      article.content,
      8000
    )
  };
}

/* =========================================================
   NEWSAPI QUERY
========================================================= */

function buildNewsQuery() {
  return [
    "India",
    "Indian government",
    "Indian economy",
    "India technology",
    "India business",
    "India politics",
    "India startup",
    "India science",
    "India sports",
    "India world news"
  ].join(" OR ");
}

async function fetchNews({
  pageSize = 20,
  page = 1
} = {}) {
  if (!NEWS_API_KEY) {
    throw new Error(
      "NEWS_API_KEY is not configured in Vercel environment variables."
    );
  }

  const params = new URLSearchParams();

  params.set(
    "q",
    buildNewsQuery()
  );

  params.set(
    "language",
    "en"
  );

  params.set(
    "sortBy",
    "publishedAt"
  );

  params.set(
    "pageSize",
    String(
      Math.min(
        Math.max(Number(pageSize) || 20, 1),
        100
      )
    )
  );

  params.set(
    "page",
    String(
      Math.max(Number(page) || 1, 1)
    )
  );

  params.set(
    "apiKey",
    NEWS_API_KEY
  );

  return fetchJson(
    `${NEWS_API_URL}?${params.toString()}`
  );
}

/* =========================================================
   GEMINI RESPONSE EXTRACTION
========================================================= */

function collectText(value, output = []) {
  if (!value) return output;

  if (typeof value === "string") {
    output.push(value);
    return output;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectText(item, output);
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

      collectText(
        value[key],
        output
      );
    }
  }

  return output;
}

function extractGeminiText(data) {
  const chunks = [];

  /*
    Current Interactions API responses
    commonly expose model output through
    steps[].content[].text
  */

  if (Array.isArray(data?.steps)) {
    for (const step of data.steps) {
      if (
        step?.type === "model_output"
      ) {
        collectText(
          step.content,
          chunks
        );
      }
    }
  }

  /*
    Compatibility with response formats
    that may expose outputs directly.
  */

  if (Array.isArray(data?.outputs)) {
    for (const output of data.outputs) {
      collectText(
        output,
        chunks
      );
    }
  }

  if (typeof data?.text === "string") {
    chunks.push(data.text);
  }

  if (
    typeof data?.output_text === "string"
  ) {
    chunks.push(
      data.output_text
    );
  }

  return chunks
    .join("\n")
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();
}

/* =========================================================
   JSON PARSER
========================================================= */

function parseGeminiJson(text) {
  if (!text) {
    throw new Error(
      "Gemini returned an empty response."
    );
  }

  const cleaned = text
    .replace(/```json/gi, "")
    .replace(/```/g, "")
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {}

  const firstObject =
    cleaned.indexOf("{");

  const lastObject =
    cleaned.lastIndexOf("}");

  if (
    firstObject !== -1 &&
    lastObject > firstObject
  ) {
    const candidate =
      cleaned.slice(
        firstObject,
        lastObject + 1
      );

    try {
      return JSON.parse(candidate);
    } catch {}
  }

  throw new Error(
    "Gemini returned invalid JSON."
  );
}

/* =========================================================
   EDITORIAL SAFETY
========================================================= */

function detectSafety(article) {
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
      regex:
        /\b(death|dead|died|dies|killed|murder|suicide)\b/i,

      flag:
        "Potential death or fatality claim"
    },

    {
      regex:
        /\b(terror|terrorist|bomb|blast|explosion)\b/i,

      flag:
        "Potential terrorism or attack claim"
    },

    {
      regex:
        /\b(accused|alleged|allegation|charges)\b/i,

      flag:
        "Allegation or accusation"
    },

    {
      regex:
        /\b(fraud|scam|corruption|cheating)\b/i,

      flag:
        "Potential fraud or corruption claim"
    },

    {
      regex:
        /\b(election|elections|vote|voting|poll|ballot)\b/i,

      flag:
        "Election-related story"
    },

    {
      regex:
        /\b(prime minister|president|minister|politician|government)\b/i,

      flag:
        "Political or government-related story"
    },

    {
      regex:
        /\b(covid|vaccine|cancer|disease|medical|health|drug)\b/i,

      flag:
        "Medical or health-related story"
    },

    {
      regex:
        /\b(riot|communal|religious violence)\b/i,

      flag:
        "Potential communal or civil-unrest story"
    },

    {
      regex:
        /\b(earthquake|flood|cyclone|disaster|emergency)\b/i,

      flag:
        "Potential disaster or emergency"
    }
  ];

  for (const rule of rules) {
    if (rule.regex.test(text)) {
      flags.push(rule.flag);
    }
  }

  return {
    humanVerificationRequired:
      flags.length > 0,

    flags: [
      ...new Set(flags)
    ]
  };
}

/* =========================================================
   GEMINI TREND ANALYSIS PROMPT
========================================================= */

function buildGeminiPrompt(articles) {
  const stories = articles.map(
    (article, index) => ({
      id: index,

      source:
        article.source?.name ||
        "Unknown",

      title:
        article.title,

      description:
        article.description,

      publishedAt:
        article.publishedAt,

      url:
        article.url
    })
  );

  return `
You are NEWSFORGE AI's editorial intelligence engine.

Analyze the supplied news stories and estimate their
editorial importance, trend potential and audience relevance.

This is NOT permission to publish.

The purpose is to prioritize stories for a human/editorial
workflow.

IMPORTANT:

- Do not invent facts.
- Do not invent events.
- Do not invent sources.
- Do not change the supplied story title.
- Do not treat a publisher's claim as automatically verified.
- Scores are estimates, not facts.
- Breaking news involving deaths, disasters, crime,
  politics, elections, communal issues, allegations or
  medical claims must be flagged for human verification.
- A high trend score does NOT mean a story is verified.
- Consider India relevance heavily.
- Consider freshness.
- Consider likely public interest.
- Consider potential attention.
- Avoid sensationalism.

SCORING:

trendScore:
0-100 overall trend potential.

audienceRelevance:
0-100 relevance to a broad Indian audience.

attentionPotential:
0-100 potential to attract attention.

priority:
CRITICAL, HIGH, MEDIUM or LOW.

category:
POLITICS, BUSINESS, TECHNOLOGY, SCIENCE, HEALTH,
SPORTS, ENTERTAINMENT, WORLD, INDIA, CLIMATE,
SECURITY or OTHER.

humanVerificationRequired:
true when verification is especially important.

reasoning:
Short editorial explanation for the score.

Return ONLY valid JSON.

Required JSON structure:

{
  "stories": [
    {
      "id": 0,
      "trendScore": 0,
      "category": "OTHER",
      "priority": "MEDIUM",
      "audienceRelevance": 0,
      "attentionPotential": 0,
      "humanVerificationRequired": true,
      "reasoning": ""
    }
  ]
}

NEWS STORIES:

${JSON.stringify(
  stories,
  null,
  2
)}
`;
}

/* =========================================================
   GEMINI TREND ENGINE
========================================================= */

async function analyzeWithGemini(
  articles
) {
  if (!GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured in Vercel environment variables."
    );
  }

  const responseSchema = {
    type: "object",

    properties: {
      stories: {
        type: "array",

        items: {
          type: "object",

          properties: {
            id: {
              type: "integer"
            },

            trendScore: {
              type: "number"
            },

            category: {
              type: "string",

              enum: [
                "POLITICS",
                "BUSINESS",
                "TECHNOLOGY",
                "SCIENCE",
                "HEALTH",
                "SPORTS",
                "ENTERTAINMENT",
                "WORLD",
                "INDIA",
                "CLIMATE",
                "SECURITY",
                "OTHER"
              ]
            },

            priority: {
              type: "string",

              enum: [
                "CRITICAL",
                "HIGH",
                "MEDIUM",
                "LOW"
              ]
            },

            audienceRelevance: {
              type: "number"
            },

            attentionPotential: {
              type: "number"
            },

            humanVerificationRequired: {
              type: "boolean"
            },

            reasoning: {
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
            "reasoning"
          ]
        }
      }
    },

    required: [
      "stories"
    ]
  };

  const payload = {
    model: GEMINI_MODEL,

    input:
      buildGeminiPrompt(
        articles
      ),

    response_format: {
      type: "text",

      mime_type:
        "application/json",

      schema:
        responseSchema
    }
  };

  const response =
    await fetchJson(
      GEMINI_URL,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            GEMINI_API_KEY
        },

        body:
          JSON.stringify(payload)
      }
    );

  const text =
    extractGeminiText(
      response
    );

  const parsed =
    parseGeminiJson(
      text
    );

  return {
    parsed,
    response
  };
}

/* =========================================================
   MERGE AI DATA WITH ARTICLES
========================================================= */

function applyAiAnalysis(
  articles,
  aiStories
) {
  const map = new Map();

  for (const story of safeArray(
    aiStories
  )) {
    map.set(
      Number(story.id),
      story
    );
  }

  return articles.map(
    (article, index) => {
      const ai =
        map.get(index);

      const safety =
        detectSafety(
          article
        );

      if (!ai) {
        return {
          ...article,

          ai: {
            analyzed: false,

            trendScore: 0,

            category: "OTHER",

            priority: "MEDIUM",

            audienceRelevance: 0,

            attentionPotential: 0,

            humanVerificationRequired:
              true,

            reasoning:
              "AI analysis was not available.",

            safetyFlags:
              safety.flags
          }
        };
      }

      return {
        ...article,

        ai: {
          analyzed: true,

          trendScore:
            normalizeScore(
              ai.trendScore
            ),

          category:
            normalizeCategory(
              ai.category
            ),

          priority:
            normalizePriority(
              ai.priority
            ),

          audienceRelevance:
            normalizeScore(
              ai.audienceRelevance
            ),

          attentionPotential:
            normalizeScore(
              ai.attentionPotential
            ),

          humanVerificationRequired:
            Boolean(
              ai.humanVerificationRequired
            ) ||
            safety.humanVerificationRequired,

          reasoning:
            cleanText(
              ai.reasoning,
              1500
            ),

          safetyFlags:
            safety.flags
        }
      };
    }
  );
}

/* =========================================================
   SORTING
========================================================= */

function priorityWeight(
  priority
) {
  const weights = {
    CRITICAL: 4,
    HIGH: 3,
    MEDIUM: 2,
    LOW: 1
  };

  return (
    weights[priority] ||
    0
  );
}

function sortArticles(
  articles
) {
  return [...articles].sort(
    (a, b) => {
      const priorityDifference =
        priorityWeight(
          b.ai?.priority
        ) -
        priorityWeight(
          a.ai?.priority
        );

      if (
        priorityDifference !== 0
      ) {
        return priorityDifference;
      }

      return (
        Number(
          b.ai?.trendScore || 0
        ) -
        Number(
          a.ai?.trendScore || 0
        )
      );
    }
  );
}

/* =========================================================
   INTELLIGENCE SUMMARY
========================================================= */

function buildSummary(
  articles,
  analyzed
) {
  const highPotential =
    articles.filter(
      article =>
        Number(
          article.ai?.trendScore || 0
        ) >= 70
    ).length;

  const criticalStories =
    articles.filter(
      article =>
        article.ai?.priority ===
        "CRITICAL"
    ).length;

  const verificationRequired =
    articles.filter(
      article =>
        article.ai
          ?.humanVerificationRequired
    ).length;

  return {
    enabled:
      Boolean(
        GEMINI_API_KEY
      ),

    provider:
      "Google Gemini",

    model:
      GEMINI_MODEL,

    analyzed:

      Boolean(analyzed),

    analyzedStories:

      analyzed
        ? articles.length
        : 0,

    highPotential,

    criticalStories,

    verificationRequired
  };
}

/* =========================================================
   MAIN HANDLER
========================================================= */

export default async function handler(
  req,
  res
) {
  if (
    req.method !== "GET"
  ) {
    return res.status(405).json({
      success: false,

      error: {
        type:
          "method_not_allowed",

        message:
          "Use GET /api/news"
      }
    });
  }

  try {
    const pageSize =
      Number(
        req.query?.pageSize
      ) || 20;

    const page =
      Number(
        req.query?.page
      ) || 1;

    /* ---------------------------------------------------
       STEP 1: FETCH NEWS
    --------------------------------------------------- */

    const newsData =
      await fetchNews({
        pageSize,
        page
      });

    let articles =
      safeArray(
        newsData?.articles
      )
        .map(
          normalizeArticle
        )
        .filter(
          article =>
            article &&
            article.title &&
            article.url
        );

    articles =
      uniqueArticles(
        articles
      );

    /* ---------------------------------------------------
       STEP 2: AI ANALYSIS
    --------------------------------------------------- */

    let analyzed =
      false;

    let aiError =
      null;

    if (
      GEMINI_API_KEY &&
      articles.length
    ) {
      try {
        const aiResult =
          await analyzeWithGemini(
            articles
          );

        articles =
          applyAiAnalysis(
            articles,
            aiResult
              ?.parsed
              ?.stories
          );

        analyzed = true;

      } catch (error) {
        console.error(
          "NEWSFORGE Gemini analysis error:",
          error
        );

        aiError = {
          message:
            error?.message ||
            "AI analysis failed.",

          details:
            error?.response ||
            null
        };

        /*
          Do NOT pretend AI analysis
          succeeded.
        */

        articles =
          articles.map(
            article => {
              const safety =
                detectSafety(
                  article
                );

              return {
                ...article,

                ai: {
                  analyzed: false,

                  trendScore: 0,

                  category: "OTHER",

                  priority: "MEDIUM",

                  audienceRelevance: 0,

                  attentionPotential: 0,

                  humanVerificationRequired:
                    true,

                  reasoning:
                    "AI analysis failed. Manual verification is required.",

                  safetyFlags:
                    safety.flags
                }
              };
            }
          );
      }
    } else {
      articles =
        articles.map(
          article => {
            const safety =
              detectSafety(
                article
              );

            return {
              ...article,

              ai: {
                analyzed: false,

                trendScore: 0,

                category: "OTHER",

                priority: "MEDIUM",

                audienceRelevance: 0,

                attentionPotential: 0,

                humanVerificationRequired:
                  true,

                reasoning:
                  "Gemini is not configured.",

                safetyFlags:
                  safety.flags
              }
            };
          }
        );
    }

    /* ---------------------------------------------------
       STEP 3: SORT
    --------------------------------------------------- */

    articles =
      sortArticles(
        articles
      );

    /* ---------------------------------------------------
       STEP 4: SUMMARY
    --------------------------------------------------- */

    const intelligence =
      buildSummary(
        articles,
        analyzed
      );

    /* ---------------------------------------------------
       RESPONSE
    --------------------------------------------------- */

    return res.status(200).json({
      success: true,

      totalResults:
        newsData?.totalResults ||
        articles.length,

      page,

      pageSize,

      articles,

      ai:
        {
          ...intelligence,

          error:
            aiError
        }
    });

  } catch (error) {
    console.error(
      "NEWSFORGE news error:",
      error
    );

    return res.status(500).json({
      success: false,

      error: {
        type:
          "news_engine_error",

        message:
          error?.message ||
          "Unable to fetch news.",

        details:
          error?.response ||
          null
      }
    });
  }
}
