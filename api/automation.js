/**
 * NEWSFORGE AI
 * Automation control plane
 *
 * Provides a safe automation contract for scheduled maintenance and future
 * persistent jobs. It never publishes content by itself and never bypasses
 * the human approval gate.
 */

const ALLOWED_METHODS = ["GET", "POST", "OPTIONS"];
const AUTOMATIONS = [
  {
    id: "news-discovery",
    name: "News Discovery",
    description: "Refresh the discovery pipeline on a recurring cadence.",
    frequency: "hourly",
    action: "discover",
    enabled: true
  },
  {
    id: "approval-watch",
    name: "Approval Watch",
    description: "Surface content waiting for human editorial approval.",
    frequency: "hourly",
    action: "approval-watch",
    enabled: true
  },
  {
    id: "schedule-watch",
    name: "Schedule Watch",
    description: "Validate upcoming scheduled content before execution.",
    frequency: "hourly",
    action: "schedule-watch",
    enabled: true
  },
  {
    id: "analytics-refresh",
    name: "Analytics Refresh",
    description: "Refresh lightweight pipeline health and analytics state.",
    frequency: "daily",
    action: "analytics",
    enabled: true
  }
];

function setCors(res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", ALLOWED_METHODS.join(", "));
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Cron-Secret");
  res.setHeader("Cache-Control", "no-store, max-age=0");
}

function json(res, status, payload) {
  setCors(res);
  return res.status(status).json(payload);
}

function isCronAuthorized(req) {
  const configured = process.env.CRON_SECRET;
  if (!configured) return true;

  const supplied =
    req.headers["x-cron-secret"] ||
    (req.headers.authorization || "").replace(/^Bearer\s+/i, "");

  return supplied === configured;
}

function nowIso() {
  return new Date().toISOString();
}

module.exports = async function handler(req, res) {
  if (!ALLOWED_METHODS.includes(req.method)) {
    return json(res, 405, { ok: false, error: "Method not allowed." });
  }

  if (req.method === "OPTIONS") {
    return json(res, 204, {});
  }

  if (req.method === "POST" && !isCronAuthorized(req)) {
    return json(res, 401, { ok: false, error: "Unauthorized automation request." });
  }

  const action = String(req.query?.action || req.body?.action || "status").toLowerCase();

  if (action === "status") {
    return json(res, 200, {
      ok: true,
      service: "newsforge-automation",
      timestamp: nowIso(),
      automations: AUTOMATIONS,
      guarantees: [
        "Automation never bypasses human approval.",
        "Automation never publishes unapproved content.",
        "Production jobs should use persistent storage for durable state."
      ]
    });
  }

  const automation = AUTOMATIONS.find((item) => item.action === action || item.id === action);

  if (!automation) {
    return json(res, 404, {
      ok: false,
      error: `Unknown automation action: ${action}.`,
      availableActions: AUTOMATIONS.map((item) => item.action)
    });
  }

  return json(res, 200, {
    ok: true,
    executed: false,
    dryRun: true,
    automation: automation.id,
    message: `${automation.name} automation is ready. Connect persistent job storage and provider credentials before enabling external side effects.`,
    timestamp: nowIso()
  });
};
