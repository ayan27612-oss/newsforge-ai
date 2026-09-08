/**
 * NEWSFORGE AI
 * Content Generation Engine
 *
 * Purpose:
 * - Convert researched news into publication-ready content
 * - Generate platform-specific variants
 * - Preserve factual boundaries from research
 * - Never invent facts, quotes, statistics or sources
 * - Keep sensitive stories under human approval
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
 * - Structured JSON output
 *
 * IMPORTANT:
 * This endpoint generates content only.
 * It does NOT publish anything.
 */

const GEMINI_ENDPOINT =
  "https://generativelanguage.googleapis.com/v1beta/interactions";

const GEMINI_MODEL = "gemini-3.6-flash";

const REQUEST_TIMEOUT_MS = 60000;

const MAX_TITLE_LENGTH = 500;
const MAX_DESCRIPTION_LENGTH = 5000;
const MAX_CONTENT_LENGTH = 15000;
const MAX_RESEARCH_LENGTH = 30000;
const MAX_SOURCE_LENGTH = 500;
const MAX_URL_LENGTH = 2000;

const ALLOWED_METHODS = ["POST", "OPTIONS"];

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

/* -------------------------------------------------------------------------- */
/* HTTP / response helpers                                                    */
/* -------------------------------------------------------------------------- */

function setCors(res) {
  res.setHeader(
    "Access-Control-Allow-Origin",
    "*"
  );

  res.setHeader(
    "Access-Control-Allow-Methods",
    ALLOWED_METHODS.join(", ")
  );

  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  res.setHeader(
    "Cache-Control",
    "no-store, max-age=0"
  );

  res.setHeader(
    "Vary",
    "Origin"
  );
}

function json(res, statusCode, payload) {
  setCors(res);
  return res.status(statusCode).json(payload);
}

/* -------------------------------------------------------------------------- */
/* General utilities                                                          */
/* -------------------------------------------------------------------------- */

function cleanString(value, maxLength) {
  if (
    value === undefined ||
    value === null
  ) {
    return "";
  }

  return String(value)
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, maxLength);
}

function clamp(value, min, max) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(min, Math.round(number))
  );
}

function uniqueStrings(values) {
  if (!Array.isArray(values)) {
    return [];
  }

  return [
    ...new Set(
      values
        .map((value) =>
          cleanString(value, 5000)
        )
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
  const url = cleanString(
    value,
    MAX_URL_LENGTH
  );

  return isValidHttpUrl(url)
    ? url
    : "";
}

function nowIso() {
  return new Date().toISOString();
}

function safeDate(value) {
  const raw = cleanString(
    value,
    100
  );

  if (!raw) {
    return null;
  }

  const date = new Date(raw);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString();
}

function containsSensitiveContent(text) {
  return SENSITIVE_PATTERNS.some(
    (pattern) => pattern.test(text || "")
  );
}

/* -------------------------------------------------------------------------- */
/* Request normalization                                                      */
/* -------------------------------------------------------------------------- */

function extractPayload(body) {
  const story =
    body &&
    typeof body.story === "object" &&
    body.story !== null
      ? body.story
      : {};

  const research =
    body &&
    typeof body.research === "object" &&
    body.research !== null
      ? body.research
      : {};

  return {
    story: {
      id: cleanString(
        story.id ||
          body.storyId ||
          `story_${Date.now()}`,
        200
      ),

      title: cleanString(
        story.title ||
          story.headline ||
          body.title,
        MAX_TITLE_LENGTH
      ),

      description: cleanString(
        story.description ||
          story.summary ||
          body.description,
        MAX_DESCRIPTION_LENGTH
      ),

      content: cleanString(
        story.content ||
          story.article ||
          story.body ||
          body.content,
        MAX_CONTENT_LENGTH
      ),

      url: normalizeUrl(
        story.url ||
          story.link ||
          story.sourceUrl ||
          body.url
      ),

      source: cleanString(
        story.source ||
          story.sourceName ||
          story.publisher ||
          body.source,
        MAX_SOURCE_LENGTH
      ),

      publishedAt: safeDate(
        story.publishedAt ||
          story.published_at ||
          story.date ||
          body.publishedAt
      ),

      category: cleanString(
        story.category ||
          body.category,
        100
      ),

      trendScore: clamp(
        story.trendScore ||
          body.trendScore ||
          0,
        0,
        100
      )
    },

    research: {
      researchStatus: cleanString(
        research.researchStatus,
        100
      ),

      executiveSummary:
        cleanString(
          research.executiveSummary,
          5000
        ),

      eventSummary:
        cleanString(
          research.eventSummary,
          5000
        ),

      whatIsKnown:
        uniqueStrings(
          research.whatIsKnown
        ),

      whatIsNotKnown:
        uniqueStrings(
          research.whatIsNotKnown
        ),

      keyClaims:
        Array.isArray(
          research.keyClaims
        )
          ? research.keyClaims
          : [],

      corroboration:
        research.corroboration || {},

      contradictions:
        Array.isArray(
          research.contradictions
        )
          ? research.contradictions
          : [],

      sourceAssessment:
        Array.isArray(
          research.sourceAssessment
        )
          ? research.sourceAssessment
          : [],

      factCheck:
        research.factCheck || {},

      editorialRecommendation:
        cleanString(
          research.editorialRecommendation,
          100
        ),

      verificationPriority:
        cleanString(
          research.verificationPriority,
          100
        ),

      humanApprovalRequired:
        research.humanApprovalRequired !== false,

      verificationChecklist:
        uniqueStrings(
          research.verificationChecklist
        ),

      suggestedHeadline:
        cleanString(
          research.suggestedHeadline,
          MAX_TITLE_LENGTH
        ),

      neutralAngle:
        cleanString(
          research.neutralAngle,
          2500
        )
    },

    options: {
      platforms:
        Array.isArray(body.platforms)
          ? body.platforms
          : [
              "website",
              "instagram",
              "x",
              "youtube",
              "linkedin",
              "facebook"
            ],

      tone:
        cleanString(
          body.tone ||
            "professional",
          100
        ),

      language:
        cleanString(
          body.language ||
            "en",
          50
        ),

      generateArticle:
        body.generateArticle !== false,

      generateSocial:
        body.generateSocial !== false
    }
  };
}

function validatePayload(payload) {
  const errors = [];

  if (!payload.story.title) {
    errors.push(
      "A story title is required."
    );
  }

  if (
    !payload.story.description &&
    !payload.story.content &&
    !payload.research.executiveSummary
  ) {
    errors.push(
      "Story content or completed research is required."
    );
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Content schema                                                             */
/* -------------------------------------------------------------------------- */

const CONTENT_SCHEMA = {
  type: "object",

  properties: {
    editorialTitle: {
      type: "string"
    },

    deck: {
      type: "string"
    },

    article: {
      type: "object",

      properties: {
        headline: {
          type: "string"
        },

        subheadline: {
          type: "string"
        },

        lead: {
          type: "string"
        },

        body: {
          type: "array",
          items: {
            type: "string"
          }
        },

        keyPoints: {
          type: "array",
          items: {
            type: "string"
          }
        },

        context: {
          type: "string"
        },

        conclusion: {
          type: "string"
        },

        seoTitle: {
          type: "string"
        },

        seoDescription: {
          type: "string"
        },

        slug: {
          type: "string"
        }
      },

      required: [
        "headline",
        "subheadline",
        "lead",
        "body",
        "keyPoints",
        "context",
        "conclusion",
        "seoTitle",
        "seoDescription",
        "slug"
      ]
    },

    social: {
      type: "object",

      properties: {
        instagram: {
          type: "object",
          properties: {
            caption: {
              type: "string"
            },
            shortCaption: {
              type: "string"
            },
            hashtags: {
              type: "array",
              items: {
                type: "string"
              }
            },
            hook: {
              type: "string"
            },
            callToAction: {
              type: "string"
            }
          },
          required: [
            "caption",
            "shortCaption",
            "hashtags",
            "hook",
            "callToAction"
          ]
        },

        x: {
          type: "object",
          properties: {
            post: {
              type: "string"
            },
            thread: {
              type: "array",
              items: {
                type: "string"
              }
            },
            hashtags: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          required: [
            "post",
            "thread",
            "hashtags"
          ]
        },

        facebook: {
          type: "object",
          properties: {
            post: {
              type: "string"
            },
            headline: {
              type: "string"
            },
            hashtags: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          required: [
            "post",
            "headline",
            "hashtags"
          ]
        },

        linkedin: {
          type: "object",
          properties: {
            post: {
              type: "string"
            },
            headline: {
              type: "string"
            },
            hashtags: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          required: [
            "post",
            "headline",
            "hashtags"
          ]
        },

        youtube: {
          type: "object",
          properties: {
            title: {
              type: "string"
            },
            description: {
              type: "string"
            },
            shortDescription: {
              type: "string"
            },
            hashtags: {
              type: "array",
              items: {
                type: "string"
              }
            },
            tags: {
              type: "array",
              items: {
                type: "string"
              }
            }
          },
          required: [
            "title",
            "description",
            "shortDescription",
            "hashtags",
            "tags"
          ]
        }
      },

      required: [
        "instagram",
        "x",
        "facebook",
        "linkedin",
        "youtube"
      ]
    },

    editorialNotes: {
      type: "object",

      properties: {
        factualBoundary: {
          type: "string"
        },

        uncertaintyNotice: {
          type: "string"
        },

        sensitiveContentWarning: {
          type: "string"
        },

        publishingGuidance: {
          type: "string"
        }
      },

      required: [
        "factualBoundary",
        "uncertaintyNotice",
        "sensitiveContentWarning",
        "publishingGuidance"
      ]
    }
  },

  required: [
    "editorialTitle",
    "deck",
    "article",
    "social",
    "editorialNotes"
  ]
};

/* -------------------------------------------------------------------------- */
/* Prompt builder                                                             */
/* -------------------------------------------------------------------------- */

function buildContentPrompt(
  story,
  research,
  options,
  sensitive
) {
  const knownFacts =
    research.whatIsKnown.length
      ? research.whatIsKnown.join("\n- ")
      : "No structured known-facts list was supplied.";

  const unknownFacts =
    research.whatIsNotKnown.length
      ? research.whatIsNotKnown.join("\n- ")
      : "No structured unknown-facts list was supplied.";

  const claims =
    research.keyClaims.length
      ? research.keyClaims
          .map(
            (claim) =>
              `- ${claim.claim} | status: ${claim.status} | confidence: ${claim.confidence} | evidence: ${claim.evidence}`
          )
          .join("\n")
      : "No structured claims were supplied.";

  const contradictions =
    research.contradictions.length
      ? research.contradictions
          .map(
            (item) =>
              `- ${item.topic}: ${item.explanation} | severity: ${item.severity}`
          )
          .join("\n")
      : "No contradictions were supplied.";

  return `
You are the Content Engine of NEWSFORGE AI.

Your task is to transform a researched news story into accurate,
platform-specific publication content.

This is NOT a creative-writing exercise.

ACCURACY HAS PRIORITY OVER VIRALITY.

Never invent:
- facts
- statistics
- names
- quotes
- locations
- dates
- official statements
- causes
- motives
- casualties
- financial figures
- scientific claims
- source claims

If something is uncertain, write it as uncertain.

If a claim is an allegation, preserve the allegation framing.
Do not convert "alleged" into a confirmed fact.

If research identifies contradictions, do not silently resolve them.
Reflect the uncertainty where relevant.

If the original story is incomplete, do not fill the missing information
with imagination.

TARGET LANGUAGE:
${options.language}

DESIRED TONE:
${options.tone}

REQUESTED PLATFORMS:
${options.platforms.join(", ")}

SENSITIVE STORY:
${sensitive ? "YES. Use heightened editorial caution." : "NO."}

EDITORIAL APPROVAL:
Human approval is ALWAYS required before publication.

STORY

ID:
${story.id}

TITLE:
${story.title}

DESCRIPTION:
${story.description || "Not provided"}

ORIGINAL CONTENT:
${story.content || "Not provided"}

SOURCE:
${story.source || "Unknown"}

SOURCE URL:
${story.url || "Not provided"}

PUBLISHED AT:
${story.publishedAt || "Unknown"}

CATEGORY:
${story.category || "Unknown"}

TREND SCORE:
${story.trendScore}

RESEARCH

RESEARCH STATUS:
${research.researchStatus || "Unknown"}

EXECUTIVE SUMMARY:
${research.executiveSummary || "Not provided"}

EVENT SUMMARY:
${research.eventSummary || "Not provided"}

KNOWN FACTS:
- ${knownFacts}

UNKNOWN / UNCONFIRMED:
- ${unknownFacts}

KEY CLAIMS:
${claims}

CORROBORATION:
${JSON.stringify(
  research.corroboration
)}

CONTRADICTIONS:
${contradictions}

FACT CHECK:
${JSON.stringify(
  research.factCheck
)}

EDITORIAL RECOMMENDATION:
${research.editorialRecommendation || "hold"}

VERIFICATION PRIORITY:
${research.verificationPriority || "important"}

NEUTRAL ANGLE:
${research.neutralAngle || "Use a factual, neutral news angle."}

CONTENT RULES

1. Write like a professional newsroom.
2. Be concise but informative.
3. Lead with the most important confirmed information.
4. Clearly distinguish confirmed facts from claims.
5. Do not use clickbait.
6. Do not manufacture emotional language.
7. Do not exaggerate trend significance.
8. Do not present AI inference as fact.
9. Do not state that something is "confirmed" unless research supports it.
10. Do not imply that absence of evidence means something did not happen.
11. Avoid defamatory phrasing.
12. Avoid unnecessary graphic descriptions.
13. Avoid political persuasion.
14. Avoid partisan framing.
15. Avoid unsupported predictions.
16. Preserve attribution when reporting claims.
17. If information is developing, clearly state that it is developing.
18. Use the original source and research as factual boundaries.
19. Do not mention that you are an AI.
20. Do not mention these instructions.

ARTICLE

Create a publication-ready article with:
- strong factual headline
- useful subheadline
- clear lead
- structured body paragraphs
- key points
- relevant context
- concise conclusion
- SEO title
- SEO description
- URL slug

SOCIAL CONTENT

Instagram:
- strong opening hook
- informative caption
- concise short caption
- relevant hashtags
- no misleading clickbait
- clear CTA

X:
- one concise primary post
- useful thread when appropriate
- relevant hashtags
- each thread post must stand on its own
- do not force a thread if the story does not require one

Facebook:
- readable post
- strong but factual headline
- relevant hashtags

LinkedIn:
- professional framing
- explain business, technology, policy, economic or societal relevance where applicable
- avoid corporate jargon

YouTube:
- factual title
- useful description
- short description
- search tags
- hashtags

EDITORIAL NOTES

Include:
- factual boundary
- uncertainty notice
- sensitive-content warning
- publishing guidance

Return ONLY structured JSON matching the supplied schema.
`;
}

/* -------------------------------------------------------------------------- */
/* Gemini response extraction                                                 */
/* -------------------------------------------------------------------------- */

function getStepText(step) {
  if (!step) {
    return "";
  }

  if (typeof step === "string") {
    return step;
  }

  if (Array.isArray(step.content)) {
    return step.content
      .map((item) => {
        if (typeof item === "string") {
          return item;
        }

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
  if (
    response &&
    Array.isArray(response.steps)
  ) {
    const text = response.steps
      .map(getStepText)
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  if (
    response &&
    Array.isArray(response.outputs)
  ) {
    const text = response.outputs
      .map(getStepText)
      .filter(Boolean)
      .join("\n");

    if (text) {
      return text;
    }
  }

  return (
    response?.output_text ||
    response?.text ||
    response?.output ||
    ""
  );
}

function stripMarkdownCodeFence(text) {
  return String(text || "")
    .replace(
      /^```json\s*/i,
      ""
    )
    .replace(
      /^```\s*/i,
      ""
    )
    .replace(
      /\s*```$/i,
      ""
    )
    .trim();
}

function extractJsonObject(text) {
  const cleaned =
    stripMarkdownCodeFence(text);

  try {
    return JSON.parse(cleaned);
  } catch {
    // Continue.
  }

  const firstBrace =
    cleaned.indexOf("{");

  const lastBrace =
    cleaned.lastIndexOf("}");

  if (
    firstBrace === -1 ||
    lastBrace === -1
  ) {
    throw new Error(
      "Gemini returned no JSON content."
    );
  }

  try {
    return JSON.parse(
      cleaned.slice(
        firstBrace,
        lastBrace + 1
      )
    );
  } catch {
    throw new Error(
      "Gemini returned malformed content JSON."
    );
  }
}

/* -------------------------------------------------------------------------- */
/* Gemini call                                                                */
/* -------------------------------------------------------------------------- */

async function generateContent(
  story,
  research,
  options,
  sensitive
) {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error(
      "GEMINI_API_KEY is not configured on the server."
    );
  }

  const payload = {
    model: GEMINI_MODEL,

    input: buildContentPrompt(
      story,
      research,
      options,
      sensitive
    ),

    response_format: {
      type: "text",
      mime_type: "application/json",
      schema: CONTENT_SCHEMA
    }
  };

  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    REQUEST_TIMEOUT_MS
  );

  let response;

  try {
    response = await fetch(
      GEMINI_ENDPOINT,
      {
        method: "POST",

        headers: {
          "Content-Type":
            "application/json",

          "x-goog-api-key":
            process.env.GEMINI_API_KEY
        },

        body: JSON.stringify(
          payload
        ),

        signal:
          controller.signal
      }
    );
  } catch (error) {
    if (
      error?.name ===
      "AbortError"
    ) {
      throw new Error(
        "Gemini content generation timed out."
      );
    }

    throw new Error(
      `Gemini content network error: ${
        error?.message ||
        "Unknown error"
      }`
    );
  } finally {
    clearTimeout(timeout);
  }

  const rawText =
    await response.text();

  let data = null;

  try {
    data = rawText
      ? JSON.parse(rawText)
      : null;
  } catch {
    data = null;
  }

  if (!response.ok) {
    const message =
      data?.error?.message ||
      data?.message ||
      rawText?.slice(0, 1000) ||
      `HTTP ${response.status}`;

    throw new Error(
      `Gemini content request failed: ${message}`
    );
  }

  const modelText =
    extractModelText(data);

  if (!modelText) {
    throw new Error(
      "Gemini returned an empty content response."
    );
  }

  const content =
    extractJsonObject(modelText);

  return {
    content,
    rawResponse: data
  };
}

/* -------------------------------------------------------------------------- */
/* Content normalization                                                      */
/* -------------------------------------------------------------------------- */

function normalizeArray(
  value,
  maxLength = 5000
) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((item) =>
      cleanString(
        item,
        maxLength
      )
    )
    .filter(Boolean);
}

function normalizeContent(
  content,
  story,
  research,
  sensitive
) {
  const result =
    content &&
    typeof content === "object"
      ? content
      : {};

  const article =
    result.article || {};

  const social =
    result.social || {};

  const editorialNotes =
    result.editorialNotes || {};

  const normalized = {
    editorialTitle:
      cleanString(
        result.editorialTitle ||
          article.headline ||
          story.title,
        MAX_TITLE_LENGTH
      ),

    deck:
      cleanString(
        result.deck ||
          article.subheadline ||
          "",
        3000
      ),

    article: {
      headline:
        cleanString(
          article.headline ||
            story.title,
          MAX_TITLE_LENGTH
        ),

      subheadline:
        cleanString(
          article.subheadline,
          3000
        ),

      lead:
        cleanString(
          article.lead,
          5000
        ),

      body:
        normalizeArray(
          article.body,
          10000
        ),

      keyPoints:
        normalizeArray(
          article.keyPoints,
          1500
        ),

      context:
        cleanString(
          article.context,
          5000
        ),

      conclusion:
        cleanString(
          article.conclusion,
          5000
        ),

      seoTitle:
        cleanString(
          article.seoTitle ||
            article.headline ||
            story.title,
          200
        ),

      seoDescription:
        cleanString(
          article.seoDescription ||
            story.description,
          320
        ),

      slug:
        cleanString(
          article.slug ||
            story.title
              .toLowerCase()
              .replace(
                /[^a-z0-9]+/g,
                "-"
              )
              .replace(
                /^-+|-+$/g,
                ""
              ),
          180
        )
    },

    social: {
      instagram: {
        caption:
          cleanString(
            social.instagram
              ?.caption,
            10000
          ),

        shortCaption:
          cleanString(
            social.instagram
              ?.shortCaption,
            3000
          ),

        hashtags:
          normalizeArray(
            social.instagram
              ?.hashtags,
            100
          ).slice(0, 30),

        hook:
          cleanString(
            social.instagram
              ?.hook,
            1000
          ),

        callToAction:
          cleanString(
            social.instagram
              ?.callToAction,
            1000
          )
      },

      x: {
        post:
          cleanString(
            social.x?.post,
            2000
          ),

        thread:
          normalizeArray(
            social.x?.thread,
            2000
          ).slice(0, 20),

        hashtags:
          normalizeArray(
            social.x?.hashtags,
            100
          ).slice(0, 10)
      },

      facebook: {
        post:
          cleanString(
            social.facebook?.post,
            8000
          ),

        headline:
          cleanString(
            social.facebook?.headline,
            MAX_TITLE_LENGTH
          ),

        hashtags:
          normalizeArray(
            social.facebook?.hashtags,
            100
          ).slice(0, 20)
      },

      linkedin: {
        post:
          cleanString(
            social.linkedin?.post,
            8000
          ),

        headline:
          cleanString(
            social.linkedin?.headline,
            MAX_TITLE_LENGTH
          ),

        hashtags:
          normalizeArray(
            social.linkedin?.hashtags,
            100
          ).slice(0, 20)
      },

      youtube: {
        title:
          cleanString(
            social.youtube?.title ||
              article.headline ||
              story.title,
            200
          ),

        description:
          cleanString(
            social.youtube?.description,
            10000
          ),

        shortDescription:
          cleanString(
            social.youtube
              ?.shortDescription,
            3000
          ),

        hashtags:
          normalizeArray(
            social.youtube?.hashtags,
            100
          ).slice(0, 20),

        tags:
          normalizeArray(
            social.youtube?.tags,
            200
          ).slice(0, 30)
      }
    },

    editorialNotes: {
      factualBoundary:
        cleanString(
          editorialNotes.factualBoundary,
          5000
        ),

      uncertaintyNotice:
        cleanString(
          editorialNotes.uncertaintyNotice,
          5000
        ),

      sensitiveContentWarning:
        cleanString(
          editorialNotes.sensitiveContentWarning,
          5000
        ),

      publishingGuidance:
        cleanString(
          editorialNotes.publishingGuidance,
          5000
        )
    }
  };

  /*
   * Hard safety layer.
   *
   * Even if the model forgets to set the correct editorial note,
   * NEWSFORGE itself keeps publication locked.
   */
  normalized.editorialNotes = {
    ...normalized.editorialNotes,

    publishingGuidance:
      normalized.editorialNotes
        .publishingGuidance ||
      "Human editorial approval is required before publication."
  };

  if (sensitive) {
    normalized.editorialNotes = {
      ...normalized.editorialNotes,

      sensitiveContentWarning:
        normalized.editorialNotes
          .sensitiveContentWarning ||
        "Sensitive story. Independent verification and human editorial approval are required before publication."
    };
  }

  if (
    research.factCheck?.confidence !==
      undefined &&
    Number(
      research.factCheck.confidence
    ) < 80
  ) {
    normalized.editorialNotes =
      {
        ...normalized.editorialNotes,

        uncertaintyNotice:
          normalized.editorialNotes
            .uncertaintyNotice ||
          "Research confidence is below the normal publication threshold. Treat unresolved claims cautiously and complete human verification before publication."
      };
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Hard editorial validation                                                  */
/* -------------------------------------------------------------------------- */

function validateGeneratedContent(
  content,
  story,
  research
) {
  const problems = [];

  if (
    !content.article?.headline
  ) {
    problems.push(
      "Article headline is missing."
    );
  }

  if (
    !content.article?.lead
  ) {
    problems.push(
      "Article lead is missing."
    );
  }

  if (
    !Array.isArray(
      content.article?.body
    ) ||
    content.article.body.length === 0
  ) {
    problems.push(
      "Article body is missing."
    );
  }

  if (
    !content.social?.instagram
      ?.caption
  ) {
    problems.push(
      "Instagram caption is missing."
    );
  }

  if (
    !content.social?.x?.post
  ) {
    problems.push(
      "X post is missing."
    );
  }

  /*
   * Prevent an obviously dangerous mismatch between
   * low-confidence research and aggressive publishing copy.
   */
  const confidence = Number(
    research.factCheck?.confidence
  );

  if (
    Number.isFinite(confidence) &&
    confidence < 50
  ) {
    problems.push(
      "Research confidence is too low for normal publication content."
    );
  }

  /*
   * The generated text must not be empty after normalization.
   */
  const articleText = [
    content.article?.headline,
    content.article?.subheadline,
    content.article?.lead,
    ...(content.article?.body || []),
    content.article?.context,
    content.article?.conclusion
  ]
    .filter(Boolean)
    .join(" ");

  if (articleText.length < 150) {
    problems.push(
      "Generated article is too short to be publication-ready."
    );
  }

  /*
   * Basic story identity check.
   *
   * This is intentionally conservative. It does not attempt
   * to determine factual correctness with string matching.
   */
  if (
    story.title &&
    story.title.length > 0 &&
    articleText.length === 0
  ) {
    problems.push(
      "Generated content does not contain usable editorial text."
    );
  }

  return problems;
}

/* -------------------------------------------------------------------------- */
/* Handler                                                                    */
/* -------------------------------------------------------------------------- */

export default async function handler(
  req,
  res
) {
  setCors(res);

  if (
    req.method === "OPTIONS"
  ) {
    return res.status(204).end();
  }

  if (
    req.method !== "POST"
  ) {
    return json(res, 405, {
      success: false,

      error: {
        code:
          "METHOD_NOT_ALLOWED",

        message:
          "Content endpoint accepts POST requests only."
      }
    });
  }

  const startedAt =
    Date.now();

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
            code:
              "INVALID_JSON",

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
          code:
            "INVALID_REQUEST",

          message:
            "A JSON request body is required."
        }
      });
    }

    const payload =
      extractPayload(body);

    const validationErrors =
      validatePayload(payload);

    if (
      validationErrors.length
    ) {
      return json(res, 400, {
        success: false,

        error: {
          code:
            "INVALID_CONTENT_INPUT",

          message:
            "The supplied story or research cannot be converted into content.",

          details:
            validationErrors
        }
      });
    }

    const combinedText = [
      payload.story.title,
      payload.story.description,
      payload.story.content,
      payload.research.executiveSummary,
      payload.research.eventSummary
    ]
      .filter(Boolean)
      .join(" ");

    const sensitive =
      containsSensitiveContent(
        combinedText
      );

    /*
     * If research explicitly says human approval is required,
     * retain that state regardless of the generated content.
     */
    const researchRequiresHuman =
      payload.research
        .humanApprovalRequired !==
      false;

    const {
      content,
      rawResponse
    } =
      await generateContent(
        payload.story,
        payload.research,
        payload.options,
        sensitive
      );

    const normalized =
      normalizeContent(
        content,
        payload.story,
        payload.research,
        sensitive
      );

    const contentProblems =
      validateGeneratedContent(
        normalized,
        payload.story,
        payload.research
      );

    if (
      contentProblems.length
    ) {
      return json(res, 422, {
        success: false,

        system: {
          name: "NEWSFORGE AI",
          module: "CONTENT",
          version: "1.0.0",
          status: "blocked",
          generatedAt: nowIso()
        },

        editorial: {
          publicationAllowed:
            false,

          humanApprovalRequired:
            true,

          reason:
            "Generated content failed editorial validation."
        },

        validation: {
          passed: false,
          problems:
            contentProblems
        }
      });
    }

    const confidence =
      Number(
        payload.research
          .factCheck?.confidence
      );

    const publicationAllowed =
      false;

    const response = {
      success: true,

      system: {
        name: "NEWSFORGE AI",
        module: "CONTENT",
        version: "1.0.0",
        status: "operational",
        generatedAt: nowIso(),
        durationMs:
          Date.now() -
          startedAt
      },

      ai: {
        enabled: true,
        provider:
          "Google Gemini",
        model:
          GEMINI_MODEL
      },

      story: {
        id:
          payload.story.id,

        title:
          payload.story.title,

        source:
          payload.story.source ||
          null,

        url:
          payload.story.url ||
          null,

        publishedAt:
          payload.story.publishedAt,

        category:
          payload.story.category ||
          null,

        trendScore:
          payload.story.trendScore
      },

      research: {
        status:
          payload.research
            .researchStatus ||
          "not_specified",

        confidence:
          Number.isFinite(
            confidence
          )
            ? clamp(
                confidence,
                0,
                100
              )
            : null,

        recommendation:
          payload.research
            .editorialRecommendation ||
          "hold"
      },

      editorial: {
        publicationAllowed,

        humanApprovalRequired:
          true,

        sensitiveStory:
          sensitive,

        researchApprovalRequired:
          researchRequiresHuman,

        note:
          "Content generation never authorizes publication. All generated content must pass the NEWSFORGE AI approval workflow before distribution."
      },

      content: normalized,

      validation: {
        passed: true,

        checks: {
          headline:
            Boolean(
              normalized.article
                .headline
            ),

          lead:
            Boolean(
              normalized.article
                .lead
            ),

          articleBody:
            normalized.article
              .body.length > 0,

          socialVariants:
            true,

          factualBoundary:
            Boolean(
              normalized
                .editorialNotes
                .factualBoundary
            ),

          humanApprovalLock:
            true
        }
      },

      workflow: {
        currentStage:
          "GENERATED",

        nextStage:
          "APPROVAL",

        stages: [
          "DISCOVERY",
          "RESEARCH",
          "GENERATED",
          "APPROVAL",
          "PUBLISHING",
          "ANALYTICS"
        ]
      },

      metadata: {
        requestedPlatforms:
          payload.options
            .platforms,

        language:
          payload.options
            .language,

        tone:
          payload.options
            .tone,

        generatedAt:
          nowIso()
      }
    };

    /*
     * rawResponse intentionally omitted from the public API response.
     *
     * Gemini internals can contain tool traces and implementation
     * metadata that the frontend does not need.
     */

    void rawResponse;

    return json(
      res,
      200,
      response
    );
  } catch (error) {
    console.error(
      "[NEWSFORGE CONTENT]",
      error
    );

    const message =
      error?.message ||
      "Unexpected content engine failure.";

    let status = 500;
    let code =
      "CONTENT_ENGINE_ERROR";

    if (
      message.includes(
        "GEMINI_API_KEY"
      )
    ) {
      status = 500;
      code =
        "MISSING_GEMINI_API_KEY";
    } else if (
      message.includes(
        "timed out"
      )
    ) {
      status = 504;
      code =
        "CONTENT_GENERATION_TIMEOUT";
    } else if (
      message.includes(
        "Gemini content request failed"
      )
    ) {
      status = 502;
      code =
        "GEMINI_CONTENT_ERROR";
    }

    return json(
      res,
      status,
      {
        success: false,

        system: {
          name: "NEWSFORGE AI",
          module: "CONTENT",
          version: "1.0.0",
          status: "degraded",
          generatedAt:
            nowIso()
        },

        editorial: {
          publicationAllowed:
            false,

          humanApprovalRequired:
            true
        },

        error: {
          code,
          message,

          publicationBlocked:
            true
        }
      }
    );
  }
}
