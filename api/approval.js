/**
 * NEWSFORGE AI
 * Editorial Approval Engine
 *
 * Purpose:
 * - Create approval records for generated content
 * - Evaluate editorial readiness
 * - Enforce human approval before publication
 * - Record approve / reject / hold decisions
 * - Preserve an auditable editorial history
 *
 * Runtime:
 * - Vercel Serverless Function
 * - Node.js 18+
 *
 * IMPORTANT:
 * This endpoint does NOT publish content.
 * Approval is a separate stage from publishing.
 *
 * Supported actions:
 * - create
 * - approve
 * - reject
 * - hold
 * - review
 *
 * No database is assumed yet.
 * Records are returned in a deterministic API structure so the
 * persistence layer can be connected later without changing
 * the editorial contract.
 */

const ALLOWED_METHODS = ["POST", "OPTIONS"];

const MAX_ID_LENGTH = 200;
const MAX_TEXT_LENGTH = 5000;
const MAX_TITLE_LENGTH = 500;
const MAX_CONTENT_LENGTH = 20000;

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

function nowIso() {
  return new Date().toISOString();
}

function createId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2, 10)}`;
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
            3000
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
/* Input extraction                                                           */
/* -------------------------------------------------------------------------- */

function extractPayload(body) {
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

  const research =
    body?.research &&
    typeof body.research ===
      "object"
      ? body.research
      : {};

  const action = cleanString(
    body?.action ||
      "create",
    50
  ).toLowerCase();

  return {
    action,

    approvalId:
      cleanString(
        body?.approvalId ||
          body?.id,
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
          50
        ),

      recommendation:
        cleanString(
          research.editorialRecommendation ||
            research.recommendation ||
            body?.researchRecommendation ||
            "hold",
          50
        ).toLowerCase(),

      unresolvedIssues:
        uniqueStrings(
          research.factCheck
            ?.unresolvedIssues ||
            research.unresolvedIssues ||
            []
        ),

      contradictions:
        Array.isArray(
          research.contradictions
        )
          ? research.contradictions
          : [],

      humanApprovalRequired:
        research.humanApprovalRequired !==
        false
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

      body:
        Array.isArray(
          content.article?.body
        )
          ? content.article.body
              .map((item) =>
                cleanString(
                  item,
                  10000
                )
              )
              .filter(Boolean)
          : [
              cleanString(
                content.body ||
                  body?.body,
                MAX_CONTENT_LENGTH
              )
            ].filter(Boolean),

      article:
        cleanString(
          content.article?.lead ||
            content.article?.context ||
            content.article ||
            body?.article ||
            "",
          MAX_CONTENT_LENGTH
        ),

      social:
        content.social || {},

      editorialNotes:
        content.editorialNotes ||
        {}
    },

    reviewer: {
      id:
        cleanString(
          body?.reviewer?.id ||
            body?.reviewerId ||
            body?.userId,
          MAX_ID_LENGTH
        ),

      name:
        cleanString(
          body?.reviewer?.name ||
            body?.reviewerName ||
            "",
          300
        )
    },

    reason:
      cleanString(
        body?.reason ||
          body?.note ||
          body?.comment ||
          "",
        MAX_TEXT_LENGTH
      )
  };
}

/* -------------------------------------------------------------------------- */
/* Editorial evaluation                                                       */
/* -------------------------------------------------------------------------- */

function evaluateApproval(
  payload
) {
  const reasons = [];
  const warnings = [];
  const blockers = [];

  const storyText = [
    payload.story.title,
    payload.story.source,
    payload.content.headline,
    payload.content.article,
    ...(payload.content.body || [])
  ]
    .filter(Boolean)
    .join(" ");

  const sensitive =
    isSensitiveText(
      storyText
    );

  const confidence =
    payload.research.confidence;

  const risk =
    payload.research.factualRisk;

  const unresolved =
    payload.research
      .unresolvedIssues;

  const contradictions =
    payload.research
      .contradictions;

  /*
   * Fundamental content requirements.
   */

  if (
    !payload.story.title
  ) {
    blockers.push(
      "Story title is missing."
    );
  }

  if (
    !payload.content.headline
  ) {
    blockers.push(
      "Generated headline is missing."
    );
  }

  if (
    !payload.content.article &&
    payload.content.body.length === 0
  ) {
    blockers.push(
      "Generated article content is missing."
    );
  }

  /*
   * Research requirements.
   */

  if (
    confidence < 50
  ) {
    blockers.push(
      "Research confidence is below the minimum editorial threshold."
    );
  } else if (
    confidence < 80
  ) {
    warnings.push(
      "Research confidence is below the normal publication threshold."
    );
  } else {
    reasons.push(
      "Research confidence meets the normal threshold."
    );
  }

  if (
    ["critical", "high"].includes(
      risk
    )
  ) {
    blockers.push(
      "Factual risk is too high for direct approval."
    );
  } else if (
    risk === "medium"
  ) {
    warnings.push(
      "Research identifies medium factual risk."
    );
  }

  if (
    unresolved.length > 0
  ) {
    warnings.push(
      `${unresolved.length} unresolved research issue${
        unresolved.length === 1
          ? ""
          : "s"
      } remain.`
    );
  }

  if (
    contradictions.length > 0
  ) {
    blockers.push(
      "Research contains source contradictions requiring editorial review."
    );
  }

  /*
   * Sensitive stories always require explicit human review.
   */

  if (sensitive) {
    warnings.push(
      "Sensitive story detected. Human verification is mandatory."
    );
  }

  /*
   * Never trust a client-side request to disable human approval.
   */

  if (
    payload.research
      .humanApprovalRequired
  ) {
    reasons.push(
      "Research explicitly requires human approval."
    );
  }

  /*
   * Conservative readiness calculation.
   */

  const ready =
    blockers.length === 0 &&
    confidence >= 80 &&
    ![
      "critical",
      "high"
    ].includes(risk) &&
    contradictions.length === 0;

  return {
    ready,
    sensitive,
    confidence,
    factualRisk: risk,
    blockers,
    warnings,
    reasons
  };
}

/* -------------------------------------------------------------------------- */
/* Approval record                                                            */
/* -------------------------------------------------------------------------- */

function createApprovalRecord(
  payload,
  evaluation
) {
  const approvalId =
    payload.approvalId ||
    createId("approval");

  return {
    id: approvalId,

    storyId:
      payload.story.id ||
      createId("story"),

    status: "pending",

    decision: null,

    decisionReason: null,

    createdAt: nowIso(),

    updatedAt: nowIso(),

    reviewer: {
      id:
        payload.reviewer.id ||
        null,

      name:
        payload.reviewer.name ||
        null
    },

    story: {
      title:
        payload.story.title,

      source:
        payload.story.source ||
        null,

      url:
        payload.story.url ||
        null
    },

    editorial: {
      sensitiveStory:
        evaluation.sensitive,

      humanApprovalRequired:
        true,

      publicationAllowed:
        false,

      readyForReview:
        evaluation.ready,

      confidence:
        evaluation.confidence,

      factualRisk:
        evaluation.factualRisk
    },

    checks: {
      contentPresent:
        Boolean(
          payload.content.headline
        ) &&
        (
          Boolean(
            payload.content.article
          ) ||
          payload.content.body
            .length > 0
        ),

      researchAvailable:
        payload.research.confidence >
        0,

      confidenceThreshold:
        evaluation.confidence >=
        80,

      factualRiskAcceptable:
        ![
          "critical",
          "high"
        ].includes(
          evaluation.factualRisk
        ),

      contradictionsResolved:
        payload.research
          .contradictions
          .length === 0,

      humanReviewRequired:
        true
    },

    evaluation: {
      blockers:
        evaluation.blockers,

      warnings:
        evaluation.warnings,

      reasons:
        evaluation.reasons
    },

    workflow: {
      currentStage:
        "APPROVAL",

      previousStage:
        "GENERATED",

      nextStage:
        "PUBLISHING",

      publicationLocked:
        true
    }
  };
}

/* -------------------------------------------------------------------------- */
/* Decision validation                                                        */
/* -------------------------------------------------------------------------- */

function validateDecision(
  payload,
  evaluation
) {
  const errors = [];

  if (
    !payload.approvalId
  ) {
    errors.push(
      "approvalId is required for a decision."
    );
  }

  if (
    ![
      "approve",
      "reject",
      "hold"
    ].includes(
      payload.action
    )
  ) {
    errors.push(
      "Decision must be approve, reject, or hold."
    );
  }

  /*
   * Approval cannot bypass hard editorial blockers.
   */

  if (
    payload.action ===
      "approve" &&
    !evaluation.ready
  ) {
    errors.push(
      "This story is not eligible for approval because editorial blockers remain."
    );
  }

  /*
   * Explicit reason is required for reject/hold.
   */

  if (
    [
      "reject",
      "hold"
    ].includes(
      payload.action
    ) &&
    !payload.reason
  ) {
    errors.push(
      `A reason is required when a story is ${payload.action}ed.`
    );
  }

  return errors;
}

/* -------------------------------------------------------------------------- */
/* Decision record                                                            */
/* -------------------------------------------------------------------------- */

function applyDecision(
  approval,
  payload,
  evaluation
) {
  const timestamp =
    nowIso();

  let status =
    "pending";

  let decision =
    null;

  if (
    payload.action ===
    "approve"
  ) {
    status =
      "approved";

    decision =
      "approve";
  }

  if (
    payload.action ===
    "reject"
  ) {
    status =
      "rejected";

    decision =
      "reject";
  }

  if (
    payload.action ===
    "hold"
  ) {
    status =
      "on_hold";

    decision =
      "hold";
  }

  return {
    ...approval,

    status,

    decision,

    decisionReason:
      payload.reason ||
      null,

    updatedAt:
      timestamp,

    reviewer: {
      id:
        payload.reviewer.id ||
        approval.reviewer.id ||
        null,

      name:
        payload.reviewer.name ||
        approval.reviewer.name ||
        null
    },

    editorial: {
      ...approval.editorial,

      /*
       * Even "approved" means approved for the next
       * workflow stage. It never means direct publishing.
       */
      publicationAllowed:
        false,

      humanApprovalRequired:
        true
    },

    evaluation: {
      ...approval.evaluation,

      finalDecision:
        decision,

      finalBlockers:
        evaluation.blockers,

      finalWarnings:
        evaluation.warnings
    },

    workflow: {
      ...approval.workflow,

      currentStage:
        status ===
        "approved"
          ? "APPROVED"
          : "APPROVAL",

      nextStage:
        status ===
        "approved"
          ? "PUBLISHING"
          : "APPROVAL",

      publicationLocked:
        true
    }
  };
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
            "Approval endpoint accepts POST requests only."
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

    const evaluation =
      evaluateApproval(
        payload
      );

    /* ---------------------------------------------------------------------- */
    /* CREATE                                                                  */
    /* ---------------------------------------------------------------------- */

    if (
      payload.action ===
      "create"
    ) {
      const approval =
        createApprovalRecord(
          payload,
          evaluation
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
              "APPROVAL",

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

            humanApprovalRequired:
              true,

            approvalRequired:
              true,

            sensitiveStory:
              evaluation.sensitive
          },

          approval,

          message:
            "Editorial approval record created. Publication remains locked until an authorized human decision is recorded."
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* REVIEW                                                                  */
    /* ---------------------------------------------------------------------- */

    if (
      payload.action ===
      "review"
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
              "APPROVAL",

            version:
              "1.0.0",

            status:
              "operational",

            generatedAt:
              nowIso()
          },

          editorial: {
            publicationAllowed:
              false,

            humanApprovalRequired:
              true
          },

          review: {
            approvalId:
              payload.approvalId ||
              null,

            ready:
              evaluation.ready,

            sensitive:
              evaluation.sensitive,

            confidence:
              evaluation.confidence,

            factualRisk:
              evaluation.factualRisk,

            blockers:
              evaluation.blockers,

            warnings:
              evaluation.warnings,

            reasons:
              evaluation.reasons
          }
        }
      );
    }

    /* ---------------------------------------------------------------------- */
    /* DECISION                                                                */
    /* ---------------------------------------------------------------------- */

    const decisionErrors =
      validateDecision(
        payload,
        evaluation
      );

    if (
      decisionErrors.length
    ) {
      return json(
        res,
        422,
        {
          success: false,

          system: {
            name:
              "NEWSFORGE AI",

            module:
              "APPROVAL",

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
              true
          },

          error: {
            code:
              "APPROVAL_BLOCKED",

            message:
              "Editorial decision cannot be recorded.",

            details:
              decisionErrors
          },

          evaluation
        }
      );
    }

    /*
     * The client may send an existing approval record.
     *
     * When no full record is supplied, construct a safe temporary
     * record so the API contract remains usable during the first
     * implementation phase.
     */

    const suppliedApproval =
      body.approval &&
      typeof body.approval ===
        "object"
        ? body.approval
        : null;

    const baseApproval =
      suppliedApproval || {
        id:
          payload.approvalId,

        storyId:
          payload.story.id,

        status:
          "pending",

        decision:
          null,

        decisionReason:
          null,

        createdAt:
          nowIso(),

        updatedAt:
          nowIso(),

        reviewer: {
          id:
            payload.reviewer.id ||
            null,

          name:
            payload.reviewer.name ||
            null
        },

        story: {
          title:
            payload.story.title,

          source:
            payload.story.source ||
            null,

          url:
            payload.story.url ||
            null
        },

        editorial: {
          sensitiveStory:
            evaluation.sensitive,

          humanApprovalRequired:
            true,

          publicationAllowed:
            false,

          readyForReview:
            evaluation.ready,

          confidence:
            evaluation.confidence,

          factualRisk:
            evaluation.factualRisk
        },

        workflow: {
          currentStage:
            "APPROVAL",

          previousStage:
            "GENERATED",

          nextStage:
            "PUBLISHING",

          publicationLocked:
            true
        }
      };

    const updatedApproval =
      applyDecision(
        baseApproval,
        payload,
        evaluation
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
            "APPROVAL",

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

          humanApprovalRequired:
            true,

          publicationLock:
            true,

          note:
            updatedApproval.status ===
            "approved"
              ? "Content has passed the approval stage and may proceed to the publishing stage. Publication is still controlled by the publishing engine."
              : "Content is not authorized for publication."
        },

        approval:
          updatedApproval,

        audit: {
          event:
            `approval.${updatedApproval.status}`,

          timestamp:
            nowIso(),

          reviewer:
            payload.reviewer.id ||
            payload.reviewer.name ||
            "human_reviewer",

          reason:
            payload.reason ||
            null
        }
      }
    );
  } catch (error) {
    console.error(
      "[NEWSFORGE APPROVAL]",
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
            "APPROVAL",

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
            true
        },

        error: {
          code:
            "APPROVAL_ENGINE_ERROR",

          message:
            error?.message ||
            "Unexpected approval engine failure.",

          publicationBlocked:
            true
        }
      }
    );
  }
}
