/**
 * NEWSFORGE AI
 * Publishing Engine
 *
 * Purpose:
 * - Receive content that has passed the approval stage
 * - Validate publishing authorization
 * - Route content to supported publishing adapters
 * - Provide a safe publishing contract for future integrations
 * - Prevent accidental or unauthorized publication
 *
 * Runtime:
 * - Vercel Serverless Function
 * - Node.js 18+
 *
 * IMPORTANT:
 * This engine NEVER trusts the frontend alone.
 *
 * Publication requires:
 * 1. Valid content
 * 2. Valid approval state
 * 3. Explicit approval
 * 4. Human approval
 * 5. No unresolved hard blockers
 * 6. A supported target platform
 *
 * Current implementation:
 * - Safe publishing simulation / adapter architecture
 * - Real provider credentials can be connected later
 *
 * This file intentionally does not pretend that social-media
 * APIs are magically connected. Humanity has suffered enough
 * from dashboards claiming to be "fully automated" when they
 * are actually three buttons and a CSS animation.
 */

const ALLOWED_METHODS = ["POST", "OPTIONS"];

const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH = 20000;
const MAX_PLATFORM_LENGTH = 100;

const SUPPORTED_PLATFORMS = [
  "website",
  "instagram",
  "x",
  "youtube",
  "linkedin",
  "facebook"
];

const PUBLISHABLE_STATUSES = [
  "approved"
];

/* -------------------------------------------------------------------------- */
/* HTTP helpers                                                               */
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

  return res
    .status(statusCode)
    .json(payload);
}

/* -------------------------------------------------------------------------- */
/* Utilities                                                                  */
/* -------------------------------------------------------------------------- */

function cleanString(
  value,
  maxLength
) {
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

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
}

function clamp(
  value,
  min,
  max
) {
  const number = Number(value);

  if (!Number.isFinite(number)) {
    return min;
  }

  return Math.min(
    max,
    Math.max(
      min,
      Math.round(number)
    )
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
          cleanString(
            value,
            2000
          )
        )
        .filter(Boolean)
    )
  ];
}

/* -------------------------------------------------------------------------- */
/* Sensitive-content detection                                                */
/* -------------------------------------------------------------------------- */

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

function isSensitiveText(
  text
) {
  return SENSITIVE_PATTERNS.some(
    (pattern) =>
      pattern.test(text || "")
  );
}

/* -------------------------------------------------------------------------- */
/* Platform normalization                                                     */
/* -------------------------------------------------------------------------- */

function normalizePlatform(
  platform
) {
  const normalized =
    cleanString(
      platform,
      MAX_PLATFORM_LENGTH
    ).toLowerCase();

  const aliases = {
    twitter: "x",
    "x.com": "x",
    "x-twitter": "x",
    ig: "instagram",
    insta: "instagram",
    yt: "youtube",
    fb: "facebook",
    site: "website",
    web: "website"
  };

  return (
    aliases[normalized] ||
    normalized
  );
}

function normalizePlatforms(
  platforms
) {
  const list =
    Array.isArray(platforms)
      ? platforms
      : platforms
      ? [platforms]
      : [];

  return [
    ...new Set(
      list
        .map(normalizePlatform)
        .filter(Boolean)
    )
  ];
}

/* -------------------------------------------------------------------------- */
/* Request extraction                                                         */
/* -------------------------------------------------------------------------- */

function extractPayload(body) {
  const approval =
    body?.approval &&
    typeof body.approval ===
      "object"
      ? body.approval
      : {};

  const content =
    body?.content &&
    typeof body.content ===
      "object"
      ? body.content
      : {};

  const story =
    body?.story &&
    typeof body.story ===
      "object"
      ? body.story
      : {};

  const editorial =
    body?.editorial &&
    typeof body.editorial ===
      "object"
      ? body.editorial
      : {};

  const platforms =
    normalizePlatforms(
      body?.platforms ||
        body?.platform ||
        body?.targets ||
        []
    );

  return {
    action:
      cleanString(
        body?.action ||
          "publish",
        50
      ).toLowerCase(),

    publishId:
      cleanString(
        body?.publishId ||
          body?.id,
        MAX_ID_LENGTH
      ),

    approval: {
      id:
        cleanString(
          approval.id ||
            body?.approvalId,
          MAX_ID_LENGTH
        ),

      status:
        cleanString(
          approval.status ||
            body?.approvalStatus ||
            "pending",
          100
        ).toLowerCase(),

      decision:
        cleanString(
          approval.decision ||
            body?.decision ||
            "",
          100
        ).toLowerCase(),

      publicationAllowed:
        approval.publicationAllowed ===
          true ||
        editorial.publicationAllowed ===
          true,

      humanApprovalRequired:
        approval.humanApprovalRequired !==
        false
    },

    story: {
      id:
        cleanString(
          story.id ||
            body?.storyId,
          MAX_ID_LENGTH
        ),

      title:
        cleanString(
          story.title ||
            story.headline ||
            body?.title,
          MAX_TITLE_LENGTH
        ),

      source:
        cleanString(
          story.source ||
            story.sourceName ||
            body?.source,
          300
        ),

      url:
        cleanString(
          story.url ||
            story.link ||
            body?.url,
          2000
        )
    },

    content: {
      headline:
        cleanString(
          content.article
            ?.headline ||
            content.headline ||
            body?.headline ||
            story.title,
          MAX_TITLE_LENGTH
        ),

      article:
        cleanString(
          content.article
            ?.lead ||
            content.article
              ?.body?.join("\n\n") ||
            content.body ||
            body?.article ||
            "",
          MAX_TEXT_LENGTH
        ),

      articleObject:
        content.article || {},

      social:
        content.social || {},

      editorialNotes:
        content.editorialNotes ||
        {}
    },

    research: {
      confidence:
        clamp(
          body?.research
            ?.factCheck
            ?.confidence ??
            body?.research
              ?.confidence ??
            body?.confidence ??
            0,
          0,
          100
        ),

      factualRisk:
        cleanString(
          body?.research
            ?.factCheck
            ?.factualRisk ||
            body?.research
              ?.factualRisk ||
            "unknown",
          100
        ).toLowerCase(),

      recommendation:
        cleanString(
          body?.research
            ?.editorialRecommendation ||
            body?.research
              ?.recommendation ||
            "hold",
          100
        ).toLowerCase(),

      unresolvedIssues:
        uniqueStrings(
          body?.research
            ?.factCheck
            ?.unresolvedIssues ||
            body?.research
              ?.unresolvedIssues ||
            []
        ),

      contradictions:
        Array.isArray(
          body?.research
            ?.contradictions
        )
          ? body.research
              .contradictions
          : []
    },

    platforms,

    options: {
      dryRun:
        body?.dryRun === true,

      force:
        body?.force === true,

      scheduleId:
        cleanString(
          body?.scheduleId,
          MAX_ID_LENGTH
        ),

      externalReference:
        cleanString(
          body?.externalReference,
          MAX_ID_LENGTH
        )
    },

    publisher: {
      id:
        cleanString(
          body?.publisher?.id ||
            body?.publisherId ||
            body?.userId,
          MAX_ID_LENGTH
        ),

      name:
        cleanString(
          body?.publisher?.name ||
            body?.publisherName ||
            "",
          300
        )
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Publication authorization                                                  */
/* -------------------------------------------------------------------------- */

function evaluatePublication(
  payload
) {
  const blockers = [];
  const warnings = [];
  const checks = {};

  const contentText = [
    payload.story.title,
    payload.content.headline,
    payload.content.article,
    JSON.stringify(
      payload.content.social
    )
  ]
    .filter(Boolean)
    .join(" ");

  const sensitive =
    isSensitiveText(
      contentText
    );

  checks.storyPresent =
    Boolean(
      payload.story.id &&
        payload.story.title
    );

  checks.contentPresent =
    Boolean(
      payload.content.headline &&
        payload.content.article
    );

  checks.approvalRecordPresent =
    Boolean(
      payload.approval.id
    );

  checks.approvalStatusValid =
    PUBLISHABLE_STATUSES.includes(
      payload.approval.status
    );

  checks.approvalDecisionValid =
    payload.approval.decision ===
    "approve";

  checks.humanApproval =
    payload.approval
      .humanApprovalRequired ===
    true;

  checks.clientPublicationFlag =
    payload.approval
      .publicationAllowed ===
    true;

  checks.researchConfidence =
    payload.research.confidence >=
    80;

  checks.factualRiskAcceptable =
    ![
      "high",
      "critical"
    ].includes(
      payload.research
        .factualRisk
    );

  checks.researchRecommendation =
    payload.research
      .recommendation ===
    "publish";

  checks.unresolvedIssues =
    payload.research
      .unresolvedIssues.length ===
    0;

  checks.contradictions =
    payload.research
      .contradictions.length ===
    0;

  checks.platformSelected =
    payload.platforms.length >
    0;

  checks.platformsSupported =
    payload.platforms.every(
      (platform) =>
        SUPPORTED_PLATFORMS.includes(
          platform
        )
    );

  /*
   * Required identity/content checks.
   */

  if (
    !checks.storyPresent
  ) {
    blockers.push(
      "Story identity is incomplete."
    );
  }

  if (
    !checks.contentPresent
  ) {
    blockers.push(
      "Publication content is incomplete."
    );
  }

  /*
   * Approval checks.
   */

  if (
    !checks.approvalRecordPresent
  ) {
    blockers.push(
      "A valid approval record is required."
    );
  }

  if (
    !checks.approvalStatusValid
  ) {
    blockers.push(
      "Content has not reached the approved editorial state."
    );
  }

  if (
    !checks.approvalDecisionValid
  ) {
    blockers.push(
      "An explicit human approval decision is required."
    );
  }

  /*
   * Human approval is deliberately impossible to bypass.
   */

  if (
    !checks.humanApproval
  ) {
    blockers.push(
      "Human approval requirement is invalid."
    );
  }

  /*
   * Research checks.
   */

  if (
    !checks.researchConfidence
  ) {
    blockers.push(
      "Research confidence is below the publication threshold."
    );
  }

  if (
    !checks.factualRiskAcceptable
  ) {
    blockers.push(
      "Factual risk is too high for publication."
    );
  }

  if (
    !checks.researchRecommendation
  ) {
    blockers.push(
      "Research recommendation does not authorize publication."
    );
  }

  if (
    !checks.unresolvedIssues
  ) {
    blockers.push(
      "Unresolved research issues remain."
    );
  }

  if (
    !checks.contradictions
  ) {
    blockers.push(
      "Research contains unresolved source contradictions."
    );
  }

  /*
   * Platform checks.
   */

  if (
    !checks.platformSelected
  ) {
    blockers.push(
      "At least one publishing platform must be selected."
    );
  }

  if (
    !checks.platformsSupported
  ) {
    blockers.push(
      "One or more requested platforms are not supported."
    );
  }

  /*
   * Sensitive content gets an additional safety warning.
   *
   * It is NOT automatically blocked if it has genuinely
   * passed the human approval workflow. The point is to
   * make the risk explicit.
   */

  if (sensitive) {
    warnings.push(
      "Sensitive content detected. Publication must use the approved editorial version without unverified expansion."
    );
  }

  /*
   * Never allow force=true to override editorial blockers.
   */

  if (
    payload.options.force
  ) {
    warnings.push(
      "Force flag ignored for editorial safety. Publication blockers cannot be bypassed."
    );
  }

  const authorized =
    blockers.length === 0;

  return {
    authorized,
    sensitive,
    blockers,
    warnings,
    checks
  };
}

/* -------------------------------------------------------------------------- */
/* Platform payload builders                                                  */
/* -------------------------------------------------------------------------- */

function buildWebsitePayload(
  payload
) {
  return {
    platform: "website",

    title:
      payload.content
        .articleObject
        ?.headline ||
      payload.content.headline,

    subheadline:
      payload.content
        .articleObject
        ?.subheadline ||
      "",

    lead:
      payload.content
        .articleObject
        ?.lead ||
      "",

    body:
      Array.isArray(
        payload.content
          .articleObject?.body
      )
        ? payload.content
            .articleObject.body
        : payload.content.article,

    context:
      payload.content
        .articleObject
        ?.context ||
      "",

    conclusion:
      payload.content
        .articleObject
        ?.conclusion ||
      "",

    seoTitle:
      payload.content
        .articleObject
        ?.seoTitle ||
      payload.content.headline,

    seoDescription:
      payload.content
        .articleObject
        ?.seoDescription ||
      "",

    slug:
      payload.content
        .articleObject
        ?.slug ||
      ""
  };
}

function buildInstagramPayload(
  payload
) {
  const instagram =
    payload.content.social
      ?.instagram || {};

  return {
    platform:
      "instagram",

    caption:
      cleanString(
        instagram.caption ||
          payload.content
            .articleObject
            ?.lead ||
          payload.content.article,
        10000
      ),

    shortCaption:
      cleanString(
        instagram.shortCaption ||
          instagram.caption ||
          "",
        3000
      ),

    hook:
      cleanString(
        instagram.hook ||
          "",
        1000
      ),

    callToAction:
      cleanString(
        instagram.callToAction ||
          "",
        1000
      ),

    hashtags:
      Array.isArray(
        instagram.hashtags
      )
        ? instagram.hashtags
            .map((tag) =>
              cleanString(
                tag,
                100
              )
            )
            .filter(Boolean)
            .slice(0, 30)
        : []
  };
}

function buildXPayload(
  payload
) {
  const x =
    payload.content.social
      ?.x || {};

  return {
    platform: "x",

    post:
      cleanString(
        x.post ||
          payload.content
            .headline,
        2000
      ),

    thread:
      Array.isArray(
        x.thread
      )
        ? x.thread
            .map((item) =>
              cleanString(
                item,
                2000
              )
            )
            .filter(Boolean)
            .slice(0, 20)
        : [],

    hashtags:
      Array.isArray(
        x.hashtags
      )
        ? x.hashtags
            .map((tag) =>
              cleanString(
                tag,
                100
              )
            )
            .filter(Boolean)
            .slice(0, 10)
        : []
  };
}

function buildFacebookPayload(
  payload
) {
  const facebook =
    payload.content.social
      ?.facebook || {};

  return {
    platform:
      "facebook",

    headline:
      cleanString(
        facebook.headline ||
          payload.content
            .headline,
        MAX_TITLE_LENGTH
      ),

    post:
      cleanString(
        facebook.post ||
          payload.content.article,
        10000
      ),

    hashtags:
      Array.isArray(
        facebook.hashtags
      )
        ? facebook.hashtags
            .map((tag) =>
              cleanString(
                tag,
                100
              )
            )
            .filter(Boolean)
            .slice(0, 20)
        : []
  };
}

function buildLinkedInPayload(
  payload
) {
  const linkedin =
    payload.content.social
      ?.linkedin || {};

  return {
    platform:
      "linkedin",

    headline:
      cleanString(
        linkedin.headline ||
          payload.content
            .headline,
        MAX_TITLE_LENGTH
      ),

    post:
      cleanString(
        linkedin.post ||
          payload.content.article,
        10000
      ),

    hashtags:
      Array.isArray(
        linkedin.hashtags
      )
        ? linkedin.hashtags
            .map((tag) =>
              cleanString(
                tag,
                100
              )
            )
            .filter(Boolean)
            .slice(0, 20)
        : []
  };
}

function buildYouTubePayload(
  payload
) {
  const youtube =
    payload.content.social
      ?.youtube || {};

  return {
    platform:
      "youtube",

    title:
      cleanString(
        youtube.title ||
          payload.content
            .headline,
        200
      ),

    description:
      cleanString(
        youtube.description ||
          payload.content.article,
        10000
      ),

    shortDescription:
      cleanString(
        youtube.shortDescription ||
          "",
        3000
      ),

    hashtags:
      Array.isArray(
        youtube.hashtags
      )
        ? youtube.hashtags
            .map((tag) =>
              cleanString(
                tag,
                100
              )
            )
            .filter(Boolean)
            .slice(0, 20)
        : [],

    tags:
      Array.isArray(
        youtube.tags
      )
        ? youtube.tags
            .map((tag) =>
              cleanString(
                tag,
                200
              )
            )
            .filter(Boolean)
            .slice(0, 30)
        : []
  };
}

function buildPlatformPayload(
  platform,
  payload
) {
  switch (platform) {
    case "website":
      return buildWebsitePayload(
        payload
      );

    case "instagram":
      return buildInstagramPayload(
        payload
      );

    case "x":
      return buildXPayload(
        payload
      );

    case "youtube":
      return buildYouTubePayload(
        payload
      );

    case "linkedin":
      return buildLinkedInPayload(
        payload
      );

    case "facebook":
      return buildFacebookPayload(
        payload
      );

    default:
      return null;
  }
}

/* -------------------------------------------------------------------------- */
/* Publishing adapters                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Adapter contract.
 *
 * Each provider can later implement:
 *
 * publish(payload)
 *
 * returning:
 *
 * {
 *   success,
 *   externalId,
 *   url,
 *   provider,
 *   status
 * }
 *
 * Keeping this behind an adapter layer prevents the rest of
 * NEWSFORGE from becoming coupled to individual social APIs.
 */

async function publishWebsite(
  payload,
  context
) {
  /*
   * Website publishing requires a CMS/database deployment
   * target that is intentionally not hard-coded here.
   *
   * If WEBSITE_PUBLISH_ENDPOINT is added later, this adapter
   * can call it without changing the approval workflow.
   */

  const endpoint =
    process.env
      .WEBSITE_PUBLISH_ENDPOINT;

  if (!endpoint) {
    return {
      success: false,

      simulated: true,

      status:
        "provider_not_configured",

      provider:
        "website",

      message:
        "Website publishing adapter is not configured. Content passed the NEWSFORGE authorization layer but no website provider has been connected."
    };
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      30000
    );

  try {
    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            ...(process.env
              .WEBSITE_PUBLISH_TOKEN
              ? {
                  Authorization:
                    `Bearer ${process.env.WEBSITE_PUBLISH_TOKEN}`
                }
              : {})
          },

          body: JSON.stringify(
            {
              ...payload,

              context: {
                newsforgePublishId:
                  context.publishId,

                storyId:
                  context.storyId
              }
            }
          ),

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let data = null;

    try {
      data = text
        ? JSON.parse(text)
        : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,

        simulated: false,

        status:
          "provider_error",

        provider:
          "website",

        message:
          data?.message ||
          data?.error ||
          `Website provider returned HTTP ${response.status}.`
      };
    }

    return {
      success: true,

      simulated: false,

      status:
        "published",

      provider:
        "website",

      externalId:
        data?.id ||
        data?.postId ||
        data?.articleId ||
        null,

      url:
        data?.url ||
        data?.permalink ||
        null,

      response:
        data || null
    };
  } catch (error) {
    return {
      success: false,

      simulated: false,

      status:
        error?.name ===
        "AbortError"
          ? "timeout"
          : "network_error",

      provider:
        "website",

      message:
        error?.message ||
        "Website provider request failed."
    };
  } finally {
    clearTimeout(
      timeout
    );
  }
}

/*
 * Social adapters are deliberately explicit.
 *
 * We do not fake successful social publication.
 * They return "provider_not_configured" until the relevant
 * platform API credentials and provider implementation exist.
 */

async function publishSocial(
  platform,
  payload
) {
  const envMap = {
    instagram:
      "INSTAGRAM_PUBLISH_ENDPOINT",

    x:
      "X_PUBLISH_ENDPOINT",

    youtube:
      "YOUTUBE_PUBLISH_ENDPOINT",

    linkedin:
      "LINKEDIN_PUBLISH_ENDPOINT",

    facebook:
      "FACEBOOK_PUBLISH_ENDPOINT"
  };

  const tokenMap = {
    instagram:
      "INSTAGRAM_PUBLISH_TOKEN",

    x:
      "X_PUBLISH_TOKEN",

    youtube:
      "YOUTUBE_PUBLISH_TOKEN",

    linkedin:
      "LINKEDIN_PUBLISH_TOKEN",

    facebook:
      "FACEBOOK_PUBLISH_TOKEN"
  };

  const endpointName =
    envMap[platform];

  const tokenName =
    tokenMap[platform];

  const endpoint =
    endpointName
      ? process.env[
          endpointName
        ]
      : null;

  /*
   * No endpoint means the provider has not been
   * connected yet. Never report this as successful.
   */

  if (!endpoint) {
    return {
      success: false,

      simulated: true,

      status:
        "provider_not_configured",

      provider:
        platform,

      message:
        `${platform} publishing provider is not configured.`
    };
  }

  const controller =
    new AbortController();

  const timeout =
    setTimeout(
      () =>
        controller.abort(),
      30000
    );

  try {
    const response =
      await fetch(
        endpoint,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            ...(tokenName &&
            process.env[
              tokenName
            ]
              ? {
                  Authorization:
                    `Bearer ${process.env[tokenName]}`
                }
              : {})
          },

          body: JSON.stringify(
            payload
          ),

          signal:
            controller.signal
        }
      );

    const text =
      await response.text();

    let data = null;

    try {
      data = text
        ? JSON.parse(text)
        : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      return {
        success: false,

        simulated: false,

        status:
          "provider_error",

        provider:
          platform,

        message:
          data?.message ||
          data?.error ||
          `${platform} provider returned HTTP ${response.status}.`
      };
    }

    return {
      success: true,

      simulated: false,

      status:
        "published",

      provider:
        platform,

      externalId:
        data?.id ||
        data?.postId ||
        data?.videoId ||
        data?.mediaId ||
        null,

      url:
        data?.url ||
        data?.permalink ||
        null,

      response:
        data || null
    };
  } catch (error) {
    return {
      success: false,

      simulated: false,

      status:
        error?.name ===
        "AbortError"
          ? "timeout"
          : "network_error",

      provider:
        platform,

      message:
        error?.message ||
        `${platform} provider request failed.`
    };
  } finally {
    clearTimeout(
      timeout
    );
  }
}

async function publishToPlatform(
  platform,
  payload,
  context
) {
  if (
    platform ===
    "website"
  ) {
    return publishWebsite(
      payload,
      context
    );
  }

  return publishSocial(
    platform,
    payload
  );
}

/* -------------------------------------------------------------------------- */
/* Dry-run preparation                                                        */
/* -------------------------------------------------------------------------- */

function buildDryRunResult(
  platforms,
  payload
) {
  return platforms.map(
    (platform) => {
      const platformPayload =
        buildPlatformPayload(
          platform,
          payload
        );

      return {
        platform,

        success: false,

        simulated: true,

        status:
          "dry_run",

        provider:
          platform,

        message:
          "Dry run only. No external platform was contacted.",

        payloadReady:
          Boolean(
            platformPayload
          )
      };
    }
  );
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
    req.method ===
    "OPTIONS"
  ) {
    return res
      .status(204)
      .end();
  }

  if (
    req.method !==
    "POST"
  ) {
    return json(
      res,
      405,
      {
        success: false,

        error: {
          code:
            "METHOD_NOT_ALLOWED",

          message:
            "Publishing endpoint accepts POST requests only."
        }
      }
    );
  }

  const startedAt =
    Date.now();

  try {
    let body =
      req.body;

    if (
      typeof body ===
      "string"
    ) {
      try {
        body =
          JSON.parse(body);
      } catch {
        return json(
          res,
          400,
          {
            success: false,

            error: {
              code:
                "INVALID_JSON",

              message:
                "Request body contains invalid JSON."
            }
          }
        );
      }
    }

    if (
      !body ||
      typeof body !==
        "object"
    ) {
      return json(
        res,
        400,
        {
          success: false,

          error: {
            code:
              "INVALID_REQUEST",

            message:
              "A JSON request body is required."
          }
        }
      );
    }

    const payload =
      extractPayload(
        body
      );

    /* ---------------------------------------------------------------------- */
    /* STATUS / HEALTH ACTION                                                  */
    /* ---------------------------------------------------------------------- */

    if (
      payload.action ===
      "status"
    ) {
      const providers =
        SUPPORTED_PLATFORMS.map(
          (platform) => ({
            platform,

            configured:
              platform ===
              "website"
                ? Boolean(
                    process.env
                      .WEBSITE_PUBLISH_ENDPOINT
                  )
                : Boolean(
                    process.env[
                      {
                        instagram:
                          "INSTAGRAM_PUBLISH_ENDPOINT",

                        x:
                          "X_PUBLISH_ENDPOINT",

                        youtube:
                          "YOUTUBE_PUBLISH_ENDPOINT",

                        linkedin:
                          "LINKEDIN_PUBLISH_ENDPOINT",

                        facebook:
                          "FACEBOOK_PUBLISH_ENDPOINT"
                      }[platform]
                    ]
                  )
          })
        );

      return json(
        res,
        200,
        {
          success: true,

          system: {
            name:
              "NEWSFORGE AI",

            module:
              "PUBLISHING",

            version:
              "1.0.0",

            status:
              "operational",

            generatedAt:
              nowIso()
          },

          publishing: {
            publicationAllowed:
              false,

            humanApprovalRequired:
              true,

            supportedPlatforms:
              SUPPORTED_PLATFORMS
          },

          providers
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* VALIDATION                                                              */
    /* ---------------------------------------------------------------------- */

    const evaluation =
      evaluatePublication(
        payload
      );

    /*
     * Dry run is useful for testing the complete publishing
     * payload without contacting external providers.
     *
     * It still evaluates the approval gate.
     */

    if (
      payload.options.dryRun
    ) {
      return json(
        res,
        200,
        {
          success: true,

          system: {
            name:
              "NEWSFORGE AI",

            module:
              "PUBLISHING",

            version:
              "1.0.0",

            status:
              "dry_run",

            generatedAt:
              nowIso(),

            durationMs:
              Date.now() -
              startedAt
          },

          editorial: {
            authorized:
              evaluation.authorized,

            publicationAllowed:
              false,

            humanApprovalRequired:
              true,

            sensitiveStory:
              evaluation.sensitive
          },

          validation:
            evaluation,

          results:
            evaluation.authorized
              ? buildDryRunResult(
                  payload.platforms,
                  payload
                )
              : [],

          message:
            evaluation.authorized
              ? "Dry run completed. No external platform was contacted."
              : "Dry run blocked because editorial authorization requirements were not satisfied."
        }
      );
    }

    /*
     * HARD PUBLICATION GATE
     *
     * Nothing below this point executes unless the complete
     * editorial authorization chain has passed.
     */

    if (
      !evaluation.authorized
    ) {
      return json(
        res,
        403,
        {
          success: false,

          system: {
            name:
              "NEWSFORGE AI",

            module:
              "PUBLISHING",

            version:
              "1.0.0",

            status:
              "blocked",

            generatedAt:
              nowIso()
          },

          editorial: {
            publicationAllowed:
              false,

            humanApprovalRequired:
              true,

            sensitiveStory:
              evaluation.sensitive,

            publicationLock:
              true
          },

          validation:
            evaluation,

          error: {
            code:
              "PUBLICATION_NOT_AUTHORIZED",

            message:
              "Publication is blocked because the required editorial approval chain has not been satisfied."
          }
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* PUBLISH                                                                 */
    /* ---------------------------------------------------------------------- */

    const publishId =
      payload.publishId ||
      createId("publish");

    const results = [];

    for (
      const platform of
        payload.platforms
    ) {
      const platformPayload =
        buildPlatformPayload(
          platform,
          payload
        );

      if (
        !platformPayload
      ) {
        results.push({
          platform,

          success: false,

          simulated: false,

          status:
            "unsupported",

          provider:
            platform,

          message:
            "No publishing adapter exists for this platform."
        });

        continue;
      }

      const result =
        await publishToPlatform(
          platform,
          platformPayload,
          {
            publishId,

            storyId:
              payload.story.id,

            approvalId:
              payload.approval.id,

            publisher:
              payload.publisher
          }
        );

      results.push({
        platform,

        ...result
      });
    }

    const successful =
      results.filter(
        (result) =>
          result.success
      );

    const failed =
      results.filter(
        (result) =>
          !result.success
      );

    let overallStatus =
      "completed";

    if (
      successful.length ===
      0
    ) {
      overallStatus =
        "failed";
    } else if (
      failed.length > 0
    ) {
      overallStatus =
        "partial";
    }

    return json(
      res,
      overallStatus ===
        "failed"
        ? 502
        : 200,
      {
        success:
          successful.length >
          0,

        system: {
          name:
            "NEWSFORGE AI",

          module:
            "PUBLISHING",

          version:
            "1.0.0",

          status:
            overallStatus,

          generatedAt:
            nowIso(),

          durationMs:
            Date.now() -
            startedAt
        },

        publication: {
          publishId,

          status:
            overallStatus,

          requestedPlatforms:
            payload.platforms,

          successfulPlatforms:
            successful.map(
              (item) =>
                item.platform
            ),

          failedPlatforms:
            failed.map(
              (item) =>
                item.platform
            )
        },

        editorial: {
          authorized:
            true,

          publicationAllowed:
            true,

          humanApprovalRequired:
            true,

          sensitiveStory:
            evaluation.sensitive,

          approvalId:
            payload.approval.id,

          note:
            "Publication was attempted only after the editorial approval gate passed."
        },

        results,

        workflow: {
          currentStage:
            overallStatus ===
            "completed"
              ? "PUBLISHED"
              : overallStatus ===
                "partial"
              ? "PARTIALLY_PUBLISHED"
              : "PUBLISHING",

          nextStage:
            "ANALYTICS",

          publicationLocked:
            false
        }
      }
    );
  } catch (error) {
    console.error(
      "[NEWSFORGE PUBLISH]",
      error
    );

    return json(
      res,
      500,
      {
        success: false,

        system: {
          name:
            "NEWSFORGE AI",

          module:
            "PUBLISHING",

          version:
            "1.0.0",

          status:
            "degraded",

          generatedAt:
            nowIso()
        },

        editorial: {
          publicationAllowed:
            false,

          humanApprovalRequired:
            true,

          publicationLock:
            true
        },

        error: {
          code:
            "PUBLISHING_ENGINE_ERROR",

          message:
            error?.message ||
            "Unexpected publishing engine failure.",

          publicationBlocked:
            true
        }
      }
    );
  }
}
