/**
 * NEWSFORGE AI
 * Scheduling Engine
 *
 * Purpose:
 * - Create publishing schedules
 * - Validate scheduled publication requests
 * - Prevent scheduling unapproved content
 * - Calculate execution state
 * - Support one-time and recurring schedules
 * - Provide a clean contract for a future persistent scheduler
 *
 * Runtime:
 * - Vercel Serverless Function
 * - Node.js 18+
 *
 * IMPORTANT:
 * Scheduling is NOT publishing.
 *
 * A schedule may exist only after:
 * 1. Content exists
 * 2. Research has passed the required threshold
 * 3. Human approval exists
 * 4. The approval state is "approved"
 *
 * The scheduler never bypasses the publishing engine.
 */

const ALLOWED_METHODS = ["POST", "OPTIONS"];

const MAX_ID_LENGTH = 200;
const MAX_TITLE_LENGTH = 500;
const MAX_TEXT_LENGTH = 5000;

const SUPPORTED_PLATFORMS = [
  "website",
  "instagram",
  "x",
  "youtube",
  "linkedin",
  "facebook"
];

const SUPPORTED_FREQUENCIES = [
  "once",
  "hourly",
  "daily",
  "weekly",
  "monthly"
];

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

function isValidDate(value) {
  if (!value) {
    return false;
  }

  const date =
    new Date(value);

  return !Number.isNaN(
    date.getTime()
  );
}

function normalizeDate(
  value
) {
  if (
    !isValidDate(value)
  ) {
    return null;
  }

  return new Date(
    value
  ).toISOString();
}

function isSensitiveText(
  text
) {
  return SENSITIVE_PATTERNS.some(
    (pattern) =>
      pattern.test(text || "")
  );
}

function normalizePlatform(
  platform
) {
  const value =
    cleanString(
      platform,
      100
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
    aliases[value] ||
    value
  );
}

function normalizePlatforms(
  platforms
) {
  const values =
    Array.isArray(platforms)
      ? platforms
      : platforms
      ? [platforms]
      : [];

  return [
    ...new Set(
      values
        .map(
          normalizePlatform
        )
        .filter(Boolean)
    )
  ];
}

/* -------------------------------------------------------------------------- */
/* Request extraction                                                         */
/* -------------------------------------------------------------------------- */

function extractPayload(body) {
  const schedule =
    body?.schedule &&
    typeof body.schedule ===
      "object"
      ? body.schedule
      : {};

  const approval =
    body?.approval &&
    typeof body.approval ===
      "object"
      ? body.approval
      : {};

  const research =
    body?.research &&
    typeof body.research ===
      "object"
      ? body.research
      : {};

  const story =
    body?.story &&
    typeof body.story ===
      "object"
      ? body.story
      : {};

  const content =
    body?.content &&
    typeof body.content ===
      "object"
      ? body.content
      : {};

  return {
    action:
      cleanString(
        body?.action ||
          "create",
        50
      ).toLowerCase(),

    scheduleId:
      cleanString(
        body?.scheduleId ||
          body?.id ||
          schedule.id,
        MAX_ID_LENGTH
      ),

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
          20000
        )
    },

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

      humanApprovalRequired:
        approval.humanApprovalRequired !==
        false
    },

    research: {
      confidence:
        clamp(
          research.factCheck
            ?.confidence ??
            research.confidence ??
            body?.confidence ??
            0,
          0,
          100
        ),

      factualRisk:
        cleanString(
          research.factCheck
            ?.factualRisk ||
            research.factualRisk ||
            "unknown",
          100
        ).toLowerCase(),

      recommendation:
        cleanString(
          research.editorialRecommendation ||
            research.recommendation ||
            "hold",
          100
        ).toLowerCase(),

      unresolvedIssues:
        Array.isArray(
          research.factCheck
            ?.unresolvedIssues
        )
          ? research.factCheck
              .unresolvedIssues
          : Array.isArray(
              research.unresolvedIssues
            )
          ? research.unresolvedIssues
          : [],

      contradictions:
        Array.isArray(
          research.contradictions
        )
          ? research.contradictions
          : []
    },

    schedule: {
      frequency:
        cleanString(
          schedule.frequency ||
            body?.frequency ||
            "once",
          50
        ).toLowerCase(),

      runAt:
        normalizeDate(
          schedule.runAt ||
            body?.runAt ||
            body?.scheduledAt ||
            body?.publishAt
        ),

      timezone:
        cleanString(
          schedule.timezone ||
            body?.timezone ||
            "Asia/Kolkata",
          100
        ),

      startAt:
        normalizeDate(
          schedule.startAt ||
            body?.startAt ||
            body?.startDate
        ),

      endAt:
        normalizeDate(
          schedule.endAt ||
            body?.endAt ||
            body?.endDate
        ),

      maxRuns:
        clamp(
          schedule.maxRuns ??
            body?.maxRuns ??
            1,
          1,
          10000
        ),

      platforms:
        normalizePlatforms(
          schedule.platforms ||
            body?.platforms ||
            body?.platform
        ),

      enabled:
        schedule.enabled !==
          false &&
        body?.enabled !==
          false,

      cron:
        cleanString(
          schedule.cron ||
            body?.cron ||
            "",
          500
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
    },

    reason:
      cleanString(
        body?.reason ||
          body?.note ||
          "",
        MAX_TEXT_LENGTH
      )
  };
}

/* -------------------------------------------------------------------------- */
/* Schedule validation                                                        */
/* -------------------------------------------------------------------------- */

function validateSchedule(
  payload
) {
  const blockers = [];
  const warnings = [];

  const frequency =
    payload.schedule
      .frequency;

  /*
   * Story/content.
   */

  if (
    !payload.story.id
  ) {
    blockers.push(
      "A story ID is required."
    );
  }

  if (
    !payload.story.title
  ) {
    blockers.push(
      "A story title is required."
    );
  }

  if (
    !payload.content.headline
  ) {
    blockers.push(
      "Generated content is missing a headline."
    );
  }

  if (
    !payload.content.article
  ) {
    blockers.push(
      "Generated article content is missing."
    );
  }

  /*
   * Approval gate.
   */

  if (
    !payload.approval.id
  ) {
    blockers.push(
      "An approval record is required before scheduling."
    );
  }

  if (
    payload.approval.status !==
    "approved"
  ) {
    blockers.push(
      "Only content with an approved editorial status can be scheduled."
    );
  }

  if (
    payload.approval.decision !==
    "approve"
  ) {
    blockers.push(
      "An explicit human approval decision is required before scheduling."
    );
  }

  if (
    payload.approval
      .humanApprovalRequired !==
    true
  ) {
    blockers.push(
      "Human approval protection cannot be disabled."
    );
  }

  /*
   * Research gate.
   */

  if (
    payload.research.confidence <
    80
  ) {
    blockers.push(
      "Research confidence is below the scheduling threshold."
    );
  }

  if (
    [
      "high",
      "critical"
    ].includes(
      payload.research
        .factualRisk
    )
  ) {
    blockers.push(
      "Factual risk is too high for scheduling."
    );
  }

  if (
    payload.research
      .recommendation !==
    "publish"
  ) {
    blockers.push(
      "Research recommendation does not permit publication."
    );
  }

  if (
    payload.research
      .unresolvedIssues
      .length > 0
  ) {
    blockers.push(
      "Unresolved research issues remain."
    );
  }

  if (
    payload.research
      .contradictions
      .length > 0
  ) {
    blockers.push(
      "Unresolved source contradictions remain."
    );
  }

  /*
   * Frequency.
   */

  if (
    !SUPPORTED_FREQUENCIES.includes(
      frequency
    )
  ) {
    blockers.push(
      `Unsupported schedule frequency: ${frequency}.`
    );
  }

  /*
   * Timing.
   */

  if (
    frequency ===
    "once" &&
    !payload.schedule.runAt
  ) {
    blockers.push(
      "A runAt date/time is required for a one-time schedule."
    );
  }

  if (
    payload.schedule.runAt &&
    new Date(
      payload.schedule.runAt
    ).getTime() <=
      Date.now()
  ) {
    blockers.push(
      "The scheduled execution time must be in the future."
    );
  }

  if (
    payload.schedule.startAt &&
    payload.schedule.endAt &&
    new Date(
      payload.schedule.endAt
    ).getTime() <=
      new Date(
        payload.schedule.startAt
      ).getTime()
  ) {
    blockers.push(
      "Schedule end time must be after the start time."
    );
  }

  /*
   * Platforms.
   */

  if (
    payload.schedule
      .platforms.length ===
    0
  ) {
    blockers.push(
      "At least one publishing platform must be selected."
    );
  }

  const unsupported =
    payload.schedule
      .platforms.filter(
        (platform) =>
          !SUPPORTED_PLATFORMS.includes(
            platform
          )
      );

  if (
    unsupported.length
  ) {
    blockers.push(
      `Unsupported platforms: ${unsupported.join(
        ", "
      )}.`
    );
  }

  /*
   * Sensitive content.
   */

  const sensitive =
    isSensitiveText(
      [
        payload.story.title,
        payload.content.headline,
        payload.content.article
      ]
        .filter(Boolean)
        .join(" ")
    );

  if (
    sensitive
  ) {
    warnings.push(
      "Sensitive content detected. The schedule remains dependent on the approved editorial version."
    );
  }

  /*
   * Recurring schedules need a clear start point.
   */

  if (
    frequency !==
      "once" &&
    !payload.schedule.startAt &&
    !payload.schedule.runAt
  ) {
    warnings.push(
      "No explicit recurring start time was supplied. The scheduler will require a persistence layer to determine the first execution."
    );
  }

  return {
    ready:
      blockers.length === 0,

    sensitive,

    blockers,

    warnings
  };
}

/* -------------------------------------------------------------------------- */
/* Recurrence calculation                                                     */
/* -------------------------------------------------------------------------- */

function calculateNextRun(
  schedule,
  fromDate = new Date()
) {
  const frequency =
    schedule.frequency;

  /*
   * One-time schedule.
   */

  if (
    frequency ===
    "once"
  ) {
    return schedule.runAt;
  }

  /*
   * Use explicit startAt first.
   * Otherwise runAt can act as the recurrence anchor.
   */

  const anchor =
    schedule.startAt ||
    schedule.runAt;

  if (!anchor) {
    return null;
  }

  const date =
    new Date(anchor);

  const now =
    new Date(fromDate);

  /*
   * If the anchor is already in the future,
   * it is the next execution.
   */

  if (
    date.getTime() >
    now.getTime()
  ) {
    return date.toISOString();
  }

  /*
   * Advance from the anchor until the next
   * execution is in the future.
   */

  if (
    frequency ===
    "hourly"
  ) {
    const diff =
      now.getTime() -
      date.getTime();

    const hours =
      Math.floor(
        diff / 3600000
      ) + 1;

    date.setTime(
      date.getTime() +
        hours *
          3600000
    );

    return date.toISOString();
  }

  if (
    frequency ===
    "daily"
  ) {
    const diff =
      now.getTime() -
      date.getTime();

    const days =
      Math.floor(
        diff /
          86400000
      ) + 1;

    date.setDate(
      date.getDate() +
        days
    );

    return date.toISOString();
  }

  if (
    frequency ===
    "weekly"
  ) {
    const diff =
      now.getTime() -
      date.getTime();

    const weeks =
      Math.floor(
        diff /
          604800000
      ) + 1;

    date.setDate(
      date.getDate() +
        weeks * 7
    );

    return date.toISOString();
  }

  if (
    frequency ===
    "monthly"
  ) {
    while (
      date.getTime() <=
      now.getTime()
    ) {
      date.setMonth(
        date.getMonth() +
          1
      );
    }

    return date.toISOString();
  }

  return null;
}

/* -------------------------------------------------------------------------- */
/* Schedule record                                                            */
/* -------------------------------------------------------------------------- */

function createScheduleRecord(
  payload,
  validation
) {
  const scheduleId =
    payload.scheduleId ||
    createId("schedule");

  const createdAt =
    nowIso();

  const nextRun =
    calculateNextRun(
      payload.schedule
    );

  return {
    id:
      scheduleId,

    storyId:
      payload.story.id,

    approvalId:
      payload.approval.id,

    status:
      payload.schedule.enabled
        ? "scheduled"
        : "paused",

    enabled:
      payload.schedule.enabled,

    createdAt,

    updatedAt:
      createdAt,

    schedule: {
      frequency:
        payload.schedule
          .frequency,

      timezone:
        payload.schedule
          .timezone,

      runAt:
        payload.schedule
          .runAt,

      startAt:
        payload.schedule
          .startAt,

      endAt:
        payload.schedule
          .endAt,

      maxRuns:
        payload.schedule
          .maxRuns,

      cron:
        payload.schedule
          .cron,

      platforms:
        payload.schedule
          .platforms
    },

    story: {
      id:
        payload.story.id,

      title:
        payload.story.title
    },

    editorial: {
      approvalId:
        payload.approval.id,

      approvalStatus:
        payload.approval.status,

      humanApproval:
        true,

      confidence:
        payload.research
          .confidence,

      factualRisk:
        payload.research
          .factualRisk,

      sensitiveStory:
        validation.sensitive,

      publicationAllowed:
        false
    },

    execution: {
      nextRun,

      lastRun:
        null,

      runCount:
        0,

      successfulRuns:
        0,

      failedRuns:
        0,

      remainingRuns:
        payload.schedule
          .maxRuns
    },

    workflow: {
      currentStage:
        "SCHEDULED",

      previousStage:
        "APPROVED",

      nextStage:
        "PUBLISHING",

      publicationRequiresApproval:
        true,

      schedulerCannotBypassApproval:
        true
    },

    validation: {
      ready:
        validation.ready,

      blockers:
        validation.blockers,

      warnings:
        validation.warnings
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Action handling                                                            */
/* -------------------------------------------------------------------------- */

function applyScheduleAction(
  payload,
  action
) {
  const scheduleId =
    payload.scheduleId ||
    createId("schedule");

  const timestamp =
    nowIso();

  const currentStatus =
    cleanString(
      payload.schedule
        .status ||
        "scheduled",
      100
    ).toLowerCase();

  if (
    action ===
    "pause"
  ) {
    return {
      id:
        scheduleId,

      status:
        "paused",

      enabled:
        false,

      updatedAt:
        timestamp,

      message:
        "Schedule paused. No future execution should be triggered until resumed."
    };
  }

  if (
    action ===
    "resume"
  ) {
    return {
      id:
        scheduleId,

      status:
        "scheduled",

      enabled:
        true,

      updatedAt:
        timestamp,

      message:
        "Schedule resumed."
    };
  }

  if (
    action ===
    "cancel"
  ) {
    return {
      id:
        scheduleId,

      status:
        "cancelled",

      enabled:
        false,

      updatedAt:
        timestamp,

      message:
        "Schedule cancelled. Future executions are disabled."
    };
  }

  if (
    action ===
    "status"
  ) {
    return {
      id:
        scheduleId,

      status:
        currentStatus,

      enabled:
        payload.schedule
          .enabled,

      updatedAt:
        timestamp
    };
  }

  return null;
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
            "Schedule endpoint accepts POST requests only."
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
    /* STATUS / PAUSE / RESUME / CANCEL                                       */
    /* ---------------------------------------------------------------------- */

    if (
      [
        "pause",
        "resume",
        "cancel",
        "status"
      ].includes(
        payload.action
      )
    ) {
      if (
        !payload.scheduleId
      ) {
        return json(
          res,
          400,
          {
            success: false,

            error: {
              code:
                "SCHEDULE_ID_REQUIRED",

              message:
                "scheduleId is required for schedule management actions."
            }
          }
        );
      }

      const actionResult =
        applyScheduleAction(
          payload,
          payload.action
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
              "SCHEDULE",

            version:
              "1.0.0",

            status:
              "operational",

            generatedAt:
              nowIso(),

            durationMs:
              Date.now() -
              startedAt
          },

          schedule:
            actionResult,

          editorial: {
            publicationAllowed:
              false,

            humanApprovalRequired:
              true
          },

          message:
            actionResult.message ||
            "Schedule state returned."
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* CREATE                                                                  */
    /* ---------------------------------------------------------------------- */

    if (
      payload.action ===
        "create" ||
      payload.action ===
        "schedule"
    ) {
      const validation =
        validateSchedule(
          payload
        );

      if (
        !validation.ready
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
                "SCHEDULE",

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

              schedulingAllowed:
                false
            },

            validation,

            error: {
              code:
                "SCHEDULING_NOT_AUTHORIZED",

              message:
                "The story cannot be scheduled because the required editorial approval chain has not been satisfied."
            }
          }
        );
      }

      const record =
        createScheduleRecord(
          payload,
          validation
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
              "SCHEDULE",

            version:
              "1.0.0",

            status:
              "operational",

            generatedAt:
              nowIso(),

            durationMs:
              Date.now() -
              startedAt
          },

          editorial: {
            publicationAllowed:
              false,

            schedulingAllowed:
              true,

            humanApprovalRequired:
              true,

            note:
              "The schedule is authorized only because the content carries an approved editorial state. Every execution must still pass through the publishing engine."
          },

          schedule:
            record,

          message:
            "Publishing schedule created successfully."
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* NEXT RUN                                                                */
    /* ---------------------------------------------------------------------- */

    if (
      payload.action ===
      "next"
    ) {
      const validation =
        validateSchedule(
          payload
        );

      if (
        !validation.ready
      ) {
        return json(
          res,
          403,
          {
            success: false,

            editorial: {
              schedulingAllowed:
                false,

              humanApprovalRequired:
                true
            },

            validation
          }
        );
      }

      const nextRun =
        calculateNextRun(
          payload.schedule
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
              "SCHEDULE",

            version:
              "1.0.0",

            status:
              "operational",

            generatedAt:
              nowIso()
          },

          schedule: {
            frequency:
              payload.schedule
                .frequency,

            timezone:
              payload.schedule
                .timezone,

            nextRun
          },

          editorial: {
            publicationAllowed:
              false,

            humanApprovalRequired:
              true
          }
        }
      );
    }

    return json(
      res,
      400,
      {
        success: false,

        error: {
          code:
            "UNKNOWN_SCHEDULE_ACTION",

          message:
            `Unsupported schedule action: ${payload.action}.`,

          supportedActions: [
            "create",
            "schedule",
            "pause",
            "resume",
            "cancel",
            "status",
            "next"
          ]
        }
      }
    );
  } catch (error) {
    console.error(
      "[NEWSFORGE SCHEDULE]",
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
            "SCHEDULE",

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

          schedulingAllowed:
            false,

          humanApprovalRequired:
            true
        },

        error: {
          code:
            "SCHEDULE_ENGINE_ERROR",

          message:
            error?.message ||
            "Unexpected scheduling engine failure.",

          publicationBlocked:
            true
        }
      }
    );
  }
}
