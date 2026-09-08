/**
 * NEWSFORGE AI
 * Analytics Engine
 *
 * Endpoint:
 *   GET /api/analytics
 *
 * Purpose:
 *   Distribution, publishing, workflow and performance intelligence.
 *
 * Notes:
 *   - This module is intentionally provider-agnostic.
 *   - It does not fabricate social-media metrics.
 *   - Real platform metrics should be connected through authorized
 *     analytics providers later.
 *   - When providers are unavailable, the API clearly reports that
 *     analytics are not connected.
 */

const VERSION = "1.0.0";
const MODULE = "ANALYTICS";

const ALLOWED_METHODS = ["GET", "OPTIONS"];

const SUPPORTED_PLATFORMS = [
  "website",
  "instagram",
  "x",
  "youtube",
  "linkedin",
  "facebook"
];

const DEFAULT_DAYS = 7;
const MAX_DAYS = 90;

/* -------------------------------------------------------------------------- */
/* Response helpers                                                           */
/* -------------------------------------------------------------------------- */

function json(res, statusCode, payload) {
  res.status(statusCode);

  res.setHeader("Content-Type", "application/json; charset=utf-8");
  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.setHeader("Pragma", "no-cache");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader(
    "Access-Control-Allow-Methods",
    "GET, OPTIONS"
  );
  res.setHeader(
    "Access-Control-Allow-Headers",
    "Content-Type, Authorization"
  );

  return res.json(payload);
}

function errorResponse(
  res,
  statusCode,
  code,
  message,
  details = null
) {
  return json(res, statusCode, {
    success: false,

    error: {
      code,
      message,
      ...(details ? { details } : {})
    },

    system: {
      name: "NEWSFORGE AI",
      module: MODULE,
      version: VERSION,
      status: "error",
      generatedAt: new Date().toISOString()
    }
  });
}

/* -------------------------------------------------------------------------- */
/* Utility functions                                                          */
/* -------------------------------------------------------------------------- */

function safeNumber(value, fallback = 0) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return fallback;
  }

  return number;
}

function clamp(value, minimum, maximum) {
  return Math.min(
    Math.max(value, minimum),
    maximum
  );
}

function round(value, decimals = 2) {
  const factor = 10 ** decimals;

  return Math.round(
    safeNumber(value) * factor
  ) / factor;
}

function normalizeString(value, fallback = "") {
  if (typeof value !== "string") {
    return fallback;
  }

  return value.trim();
}

function normalizePlatform(platform) {
  return normalizeString(platform)
    .toLowerCase()
    .replace(/\s+/g, "");
}

function unique(values) {
  return [...new Set(values)];
}

function parseBoolean(value, fallback = false) {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value !== "string") {
    return fallback;
  }

  const normalized = value.trim().toLowerCase();

  if (["true", "1", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["false", "0", "no", "off"].includes(normalized)) {
    return false;
  }

  return fallback;
}

function parseInteger(
  value,
  fallback,
  minimum,
  maximum
) {
  const parsed = Number.parseInt(value, 10);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, minimum, maximum);
}

function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date = new Date(value);

  return !Number.isNaN(date.getTime());
}

function daysAgo(days) {
  const date = new Date();

  date.setUTCDate(
    date.getUTCDate() - days
  );

  return date;
}

function iso(value) {
  return new Date(value).toISOString();
}

/* -------------------------------------------------------------------------- */
/* Query parsing                                                              */
/* -------------------------------------------------------------------------- */

function parseQuery(req) {
  const query = req.query || {};

  const days = parseInteger(
    query.days,
    DEFAULT_DAYS,
    1,
    MAX_DAYS
  );

  const platformQuery = normalizeString(
    query.platform,
    ""
  );

  let platforms = SUPPORTED_PLATFORMS.slice();

  if (platformQuery) {
    platforms = unique(
      platformQuery
        .split(",")
        .map(normalizePlatform)
        .filter(Boolean)
    );

    platforms = platforms.filter(
      platform =>
        SUPPORTED_PLATFORMS.includes(platform)
    );
  }

  const category = normalizeString(
    query.category,
    ""
  );

  const source = normalizeString(
    query.source,
    ""
  );

  const includeEmpty = parseBoolean(
    query.includeEmpty,
    false
  );

  return {
    days,
    platforms,
    category,
    source,
    includeEmpty
  };
}

/* -------------------------------------------------------------------------- */
/* Provider configuration                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Analytics providers are intentionally represented as adapters.
 *
 * The project can later connect:
 *
 *   - Meta Insights
 *   - YouTube Analytics
 *   - X analytics
 *   - LinkedIn analytics
 *   - Website analytics
 *
 * without changing the public NEWSFORGE analytics contract.
 *
 * An endpoint is considered configured only when both endpoint and token
 * exist. Missing configuration must never be presented as zero performance.
 */

const PROVIDER_CONFIG = {
  website: {
    endpoint: process.env.WEBSITE_ANALYTICS_ENDPOINT,
    token: process.env.WEBSITE_ANALYTICS_TOKEN
  },

  instagram: {
    endpoint: process.env.INSTAGRAM_ANALYTICS_ENDPOINT,
    token: process.env.INSTAGRAM_ANALYTICS_TOKEN
  },

  x: {
    endpoint: process.env.X_ANALYTICS_ENDPOINT,
    token: process.env.X_ANALYTICS_TOKEN
  },

  youtube: {
    endpoint: process.env.YOUTUBE_ANALYTICS_ENDPOINT,
    token: process.env.YOUTUBE_ANALYTICS_TOKEN
  },

  linkedin: {
    endpoint: process.env.LINKEDIN_ANALYTICS_ENDPOINT,
    token: process.env.LINKEDIN_ANALYTICS_TOKEN
  },

  facebook: {
    endpoint: process.env.FACEBOOK_ANALYTICS_ENDPOINT,
    token: process.env.FACEBOOK_ANALYTICS_TOKEN
  }
};

function providerConfigured(platform) {
  const config =
    PROVIDER_CONFIG[platform];

  return Boolean(
    config &&
    config.endpoint &&
    config.token
  );
}

/* -------------------------------------------------------------------------- */
/* Empty analytics model                                                      */
/* -------------------------------------------------------------------------- */

/**
 * This structure represents unavailable metrics explicitly.
 *
 * null is used instead of 0 because:
 *
 *   0 = the provider reported zero.
 *   null = the provider has not supplied a metric.
 *
 * Humans apparently need this distinction explained to machines.
 */

function emptyMetrics() {
  return {
    impressions: null,
    reach: null,
    views: null,
    clicks: null,
    likes: null,
    comments: null,
    shares: null,
    saves: null,
    subscribers: null,
    followers: null,

    engagementRate: null,
    clickThroughRate: null,
    averageWatchTimeSeconds: null,

    available: false
  };
}

function emptyPlatformResult(platform) {
  return {
    platform,

    connected:
      providerConfigured(platform),

    status:
      providerConfigured(platform)
        ? "configured"
        : "not_configured",

    metrics: emptyMetrics(),

    fetchedAt: null,

    error: providerConfigured(platform)
      ? null
      : "Analytics provider is not configured."
  };
}

/* -------------------------------------------------------------------------- */
/* Provider request                                                           */
/* -------------------------------------------------------------------------- */

async function fetchWithTimeout(
  url,
  options = {},
  timeoutMs = 12000
) {
  const controller =
    new AbortController();

  const timeout = setTimeout(
    () => controller.abort(),
    timeoutMs
  );

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal
    });
  } finally {
    clearTimeout(timeout);
  }
}

async function safeJson(response) {
  const text =
    await response.text();

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    return {
      raw: text
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Metric normalization                                                       */
/* -------------------------------------------------------------------------- */

function firstNumber(
  object,
  keys
) {
  for (const key of keys) {
    if (
      object &&
      object[key] !== undefined &&
      object[key] !== null
    ) {
      const value =
        Number(object[key]);

      if (Number.isFinite(value)) {
        return value;
      }
    }
  }

  return null;
}

function normalizeMetrics(raw) {
  if (!raw || typeof raw !== "object") {
    return emptyMetrics();
  }

  const metrics = {
    impressions: firstNumber(raw, [
      "impressions",
      "impression",
      "totalImpressions"
    ]),

    reach: firstNumber(raw, [
      "reach",
      "uniqueReach",
      "totalReach"
    ]),

    views: firstNumber(raw, [
      "views",
      "videoViews",
      "totalViews"
    ]),

    clicks: firstNumber(raw, [
      "clicks",
      "linkClicks",
      "totalClicks"
    ]),

    likes: firstNumber(raw, [
      "likes",
      "reactions",
      "totalLikes"
    ]),

    comments: firstNumber(raw, [
      "comments",
      "totalComments"
    ]),

    shares: firstNumber(raw, [
      "shares",
      "reposts",
      "totalShares"
    ]),

    saves: firstNumber(raw, [
      "saves",
      "bookmarks",
      "totalSaves"
    ]),

    subscribers: firstNumber(raw, [
      "subscribers",
      "subscriberCount"
    ]),

    followers: firstNumber(raw, [
      "followers",
      "followerCount"
    ]),

    engagementRate: firstNumber(raw, [
      "engagementRate",
      "engagement_rate"
    ]),

    clickThroughRate: firstNumber(raw, [
      "clickThroughRate",
      "ctr",
      "click_through_rate"
    ]),

    averageWatchTimeSeconds:
      firstNumber(raw, [
        "averageWatchTimeSeconds",
        "average_watch_time_seconds",
        "avgWatchTimeSeconds"
      ])
  };

  const engagementComponents = [
    metrics.likes,
    metrics.comments,
    metrics.shares,
    metrics.saves
  ];

  const hasEngagement =
    engagementComponents.some(
      value =>
        value !== null
    );

  const denominator =
    metrics.impressions ??
    metrics.reach ??
    metrics.views;

  if (
    metrics.engagementRate === null &&
    hasEngagement &&
    denominator > 0
  ) {
    const engagementTotal =
      engagementComponents
        .filter(value => value !== null)
        .reduce(
          (sum, value) =>
            sum + value,
          0
        );

    metrics.engagementRate =
      round(
        (engagementTotal /
          denominator) *
          100,
        2
      );
  }

  if (
    metrics.clickThroughRate === null &&
    metrics.clicks !== null &&
    denominator > 0
  ) {
    metrics.clickThroughRate =
      round(
        (metrics.clicks /
          denominator) *
          100,
        2
      );
  }

  metrics.available =
    Object.entries(metrics)
      .filter(
        ([key]) =>
          key !== "available"
      )
      .some(
        ([, value]) =>
          value !== null
      );

  return metrics;
}

/* -------------------------------------------------------------------------- */
/* Platform adapter                                                           */
/* -------------------------------------------------------------------------- */

async function fetchPlatformAnalytics(
  platform,
  options
) {
  const result =
    emptyPlatformResult(platform);

  if (!providerConfigured(platform)) {
    return result;
  }

  const config =
    PROVIDER_CONFIG[platform];

  const params =
    new URLSearchParams({
      days: String(options.days),
      ...(options.category
        ? {
            category:
              options.category
          }
        : {}),
      ...(options.source
        ? {
            source:
              options.source
          }
        : {})
    });

  const separator =
    config.endpoint.includes("?")
      ? "&"
      : "?";

  const url =
    `${config.endpoint}` +
    `${separator}` +
    `${params.toString()}`;

  try {
    const response =
      await fetchWithTimeout(
        url,
        {
          method: "GET",
          headers: {
            Accept:
              "application/json",
            Authorization:
              `Bearer ${config.token}`
          }
        }
      );

    const data =
      await safeJson(response);

    if (!response.ok) {
      return {
        ...result,

        status: "provider_error",

        error:
          data?.error?.message ||
          data?.message ||
          `Analytics provider returned HTTP ${response.status}.`,

        fetchedAt:
          new Date().toISOString()
      };
    }

    /**
     * Providers can return either:
     *
     *   { metrics: {...} }
     *
     * or:
     *
     *   {...metrics}
     *
     * The adapter accepts both.
     */
    const rawMetrics =
      data?.metrics ||
      data?.data ||
      data ||
      {};

    return {
      platform,

      connected: true,

      status: "available",

      metrics:
        normalizeMetrics(
          rawMetrics
        ),

      fetchedAt:
        new Date().toISOString(),

      error: null
    };
  } catch (error) {
    const message =
      error?.name === "AbortError"
        ? "Analytics provider request timed out."
        : "Unable to retrieve analytics from provider.";

    return {
      ...result,

      status: "provider_error",

      error: message,

      fetchedAt:
        new Date().toISOString()
    };
  }
}

/* -------------------------------------------------------------------------- */
/* Aggregation                                                                */
/* -------------------------------------------------------------------------- */

function sumNullable(values) {
  const available =
    values.filter(
      value =>
        value !== null &&
        Number.isFinite(value)
    );

  if (!available.length) {
    return null;
  }

  return available.reduce(
    (sum, value) =>
      sum + value,
    0
  );
}

function weightedRate(
  values,
  weights
) {
  let numerator = 0;
  let denominator = 0;

  for (
    let i = 0;
    i < values.length;
    i++
  ) {
    const value =
      values[i];

    const weight =
      weights[i];

    if (
      value === null ||
      !Number.isFinite(value) ||
      !weight ||
      !Number.isFinite(weight)
    ) {
      continue;
    }

    numerator +=
      value * weight;

    denominator += weight;
  }

  if (!denominator) {
    return null;
  }

  return round(
    numerator / denominator,
    2
  );
}

function aggregateMetrics(results) {
  const metrics =
    results.map(
      item => item.metrics
    );

  const impressions =
    sumNullable(
      metrics.map(
        item => item.impressions
      )
    );

  const reach =
    sumNullable(
      metrics.map(
        item => item.reach
      )
    );

  const views =
    sumNullable(
      metrics.map(
        item => item.views
      )
    );

  const clicks =
    sumNullable(
      metrics.map(
        item => item.clicks
      )
    );

  const likes =
    sumNullable(
      metrics.map(
        item => item.likes
      )
    );

  const comments =
    sumNullable(
      metrics.map(
        item => item.comments
      )
    );

  const shares =
    sumNullable(
      metrics.map(
        item => item.shares
      )
    );

  const saves =
    sumNullable(
      metrics.map(
        item => item.saves
      )
    );

  const subscribers =
    sumNullable(
      metrics.map(
        item => item.subscribers
      )
    );

  const followers =
    sumNullable(
      metrics.map(
        item => item.followers
      )
    );

  const engagementRate =
    weightedRate(
      metrics.map(
        item =>
          item.engagementRate
      ),
      metrics.map(
        item =>
          item.impressions ??
          item.reach ??
          item.views ??
          0
      )
    );

  const clickThroughRate =
    weightedRate(
      metrics.map(
        item =>
          item.clickThroughRate
      ),
      metrics.map(
        item =>
          item.impressions ??
          item.reach ??
          item.views ??
          0
      )
    );

  const averageWatchTimeSeconds =
    weightedRate(
      metrics.map(
        item =>
          item.averageWatchTimeSeconds
      ),
      metrics.map(
        item =>
          item.views ??
          0
      )
    );

  return {
    impressions,
    reach,
    views,
    clicks,
    likes,
    comments,
    shares,
    saves,
    subscribers,
    followers,

    engagementRate,
    clickThroughRate,
    averageWatchTimeSeconds,

    available:
      results.some(
        result =>
          result.metrics.available
      )
  };
}

/* -------------------------------------------------------------------------- */
/* Performance intelligence                                                   */
/* -------------------------------------------------------------------------- */

function calculateEngagementVolume(metrics) {
  return sumNullable([
    metrics.likes,
    metrics.comments,
    metrics.shares,
    metrics.saves
  ]);
}

function rankPlatforms(results) {
  return results
    .map(result => {
      const metrics =
        result.metrics;

      const engagement =
        calculateEngagementVolume(
          metrics
        );

      const denominator =
        metrics.impressions ??
        metrics.reach ??
        metrics.views;

      const rate =
        metrics.engagementRate;

      return {
        platform:
          result.platform,

        available:
          metrics.available,

        engagementVolume:
          engagement,

        engagementRate:
          rate,

        audienceVolume:
          denominator
      };
    })
    .filter(
      item =>
        item.available
    )
    .sort((a, b) => {
      const rateA =
        a.engagementRate ??
        -1;

      const rateB =
        b.engagementRate ??
        -1;

      return rateB - rateA;
    });
}

function buildInsights(
  aggregate,
  platformResults,
  options
) {
  const insights = [];

  const ranked =
    rankPlatforms(
      platformResults
    );

  if (!aggregate.available) {
    insights.push({
      type: "availability",
      priority: "high",
      message:
        "No connected analytics provider returned performance metrics for this period.",
      action:
        "Connect authorized analytics providers before treating performance metrics as measured data."
    });

    return insights;
  }

  if (
    ranked.length > 0 &&
    ranked[0].engagementRate !== null
  ) {
    insights.push({
      type: "platform",
      priority: "medium",
      message:
        `${ranked[0].platform} currently has the strongest measured engagement rate among connected platforms.`,
      action:
        "Use this platform as a signal for future content distribution, while continuing to compare against audience volume."
    });
  }

  if (
    aggregate.clickThroughRate !== null
  ) {
    if (
      aggregate.clickThroughRate >= 5
    ) {
      insights.push({
        type: "conversion",
        priority: "low",
        message:
          "Measured click-through rate is strong for the selected period.",
        action:
          "Preserve the strongest headline and call-to-action patterns in future content."
      });
    } else if (
      aggregate.clickThroughRate < 1
    ) {
      insights.push({
        type: "conversion",
        priority: "medium",
        message:
          "Measured click-through rate is relatively low.",
        action:
          "Review headline clarity, source framing and calls to action."
      });
    }
  }

  if (
    aggregate.engagementRate !== null
  ) {
    if (
      aggregate.engagementRate >= 5
    ) {
      insights.push({
        type: "engagement",
        priority: "low",
        message:
          "Overall measured engagement rate is healthy.",
        action:
          "Identify recurring topics and formats associated with the strongest engagement."
      });
    } else if (
      aggregate.engagementRate < 1
    ) {
      insights.push({
        type: "engagement",
        priority: "medium",
        message:
          "Overall measured engagement rate is relatively low.",
        action:
          "Compare topic selection, publishing time and platform-specific formatting."
      });
    }
  }

  if (
    options.category
  ) {
    insights.push({
      type: "filter",
      priority: "low",
      message:
        `Analytics are filtered to category "${options.category}".`,
      action:
        "Compare category-level performance against the unfiltered reporting period."
    });
  }

  return insights;
}

/* -------------------------------------------------------------------------- */
/* Editorial analytics                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Workflow counts are returned as unavailable until a persistent event store
 * exists.
 *
 * This is deliberate.
 *
 * Reporting "0 approvals" when the system simply has no database would be
 * misleading.
 */

function emptyWorkflowAnalytics() {
  return {
    discovered: null,
    researched: null,
    generated: null,
    pendingApproval: null,
    approved: null,
    rejected: null,
    held: null,
    published: null,
    scheduled: null,

    available: false
  };
}

function buildWorkflowAnalytics() {
  return emptyWorkflowAnalytics();
}

/* -------------------------------------------------------------------------- */
/* Content intelligence                                                       */
/* -------------------------------------------------------------------------- */

function buildContentIntelligence(
  aggregate,
  platformResults
) {
  const available =
    aggregate.available;

  if (!available) {
    return {
      available: false,

      strongestPlatform: null,

      strongestMetric: null,

      recommendations: [
        "Connect analytics providers to enable measured content-performance intelligence."
      ]
    };
  }

  const ranked =
    rankPlatforms(
      platformResults
    );

  const strongest =
    ranked[0] || null;

  const recommendations = [];

  if (
    strongest &&
    strongest.engagementRate !== null
  ) {
    recommendations.push(
      `Prioritize formats that historically perform well on ${strongest.platform}.`
    );
  }

  if (
    aggregate.views !== null &&
    aggregate.views > 0
  ) {
    recommendations.push(
      "Compare high-view stories against engagement volume before treating reach as content success."
    );
  }

  recommendations.push(
    "Use analytics as a distribution signal, not as a substitute for editorial verification."
  );

  return {
    available: true,

    strongestPlatform:
      strongest?.platform ||
      null,

    strongestMetric:
      strongest?.engagementRate ??
      null,

    recommendations
  };
}

/* -------------------------------------------------------------------------- */
/* Health summary                                                             */
/* -------------------------------------------------------------------------- */

function buildHealth(
  platformResults
) {
  const configured =
    platformResults.filter(
      result =>
        result.connected
    ).length;

  const available =
    platformResults.filter(
      result =>
        result.status ===
        "available"
    ).length;

  const providerErrors =
    platformResults.filter(
      result =>
        result.status ===
        "provider_error"
    ).length;

  let status = "disconnected";

  if (available > 0) {
    status =
      providerErrors > 0
        ? "degraded"
        : "operational";
  } else if (configured > 0) {
    status = "degraded";
  }

  return {
    status,

    supportedPlatforms:
      SUPPORTED_PLATFORMS.length,

    configuredProviders:
      configured,

    availableProviders:
      available,

    providerErrors
  };
}

/* -------------------------------------------------------------------------- */
/* Main handler                                                               */
/* -------------------------------------------------------------------------- */

export default async function handler(
  req,
  res
) {
  if (
    !ALLOWED_METHODS.includes(
      req.method
    )
  ) {
    res.setHeader(
      "Allow",
      ALLOWED_METHODS.join(", ")
    );

    return errorResponse(
      res,
      405,
      "METHOD_NOT_ALLOWED",
      `Method ${req.method} is not supported by the analytics endpoint.`
    );
  }

  if (req.method === "OPTIONS") {
    res.status(204);

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
      "Content-Type, Authorization"
    );

    return res.end();
  }

  const startedAt =
    Date.now();

  try {
    const options =
      parseQuery(req);

    const periodEnd =
      new Date();

    const periodStart =
      daysAgo(options.days);

    const platformResults =
      await Promise.all(
        options.platforms.map(
          platform =>
            fetchPlatformAnalytics(
              platform,
              options
            )
        )
      );

    const aggregate =
      aggregateMetrics(
        platformResults
      );

    const workflow =
      buildWorkflowAnalytics();

    const insights =
      buildInsights(
        aggregate,
        platformResults,
        options
      );

    const contentIntelligence =
      buildContentIntelligence(
        aggregate,
        platformResults
      );

    const health =
      buildHealth(
        platformResults
      );

    const response = {
      success: true,

      system: {
        name: "NEWSFORGE AI",
        module: MODULE,
        version: VERSION,
        status: health.status,
        generatedAt:
          new Date().toISOString(),

        processingTimeMs:
          Date.now() - startedAt
      },

      period: {
        days: options.days,

        start:
          periodStart.toISOString(),

        end:
          periodEnd.toISOString()
      },

      filters: {
        platforms:
          options.platforms,

        category:
          options.category ||
          null,

        source:
          options.source ||
          null
      },

      availability: {
        measured:
          aggregate.available,

        note:
          aggregate.available
            ? "Metrics below were returned by one or more configured analytics providers."
            : "No measured analytics are currently available. Null metrics must not be interpreted as zero."
      },

      overview: aggregate,

      platforms:
        platformResults,

      ranking: {
        platforms:
          rankPlatforms(
            platformResults
          )
      },

      workflow,

      contentIntelligence,

      insights,

      health,

      editorial: {
        analyticsDoNotOverrideVerification:
          true,

        publicationDecisionSource:
          "approval-and-publishing-engine",

        note:
          "Performance analytics inform distribution strategy but never override editorial verification, approval or publishing safeguards."
      }
    };

    return json(
      res,
      200,
      response
    );
  } catch (error) {
    console.error(
      "NEWSFORGE ANALYTICS ERROR:",
      error
    );

    return errorResponse(
      res,
      500,
      "ANALYTICS_ENGINE_ERROR",
      "The analytics engine encountered an unexpected error.",
      {
        message:
          error?.message ||
          "Unknown error."
      }
    );
  }
}
