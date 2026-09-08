export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

  /*
  ============================================================
  NEWSFORGE AI
  RESEARCH ENGINE V2
  Gemini Interactions API
  Google Search + URL Context
  Structured Research Output
  ============================================================
  */

  if (req.method !== "POST") {
    return res.status(405).json({
      status: "error",
      message: "Method not allowed. Use POST."
    });
  }

  const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

  if (!GEMINI_API_KEY) {
    return res.status(500).json({
      status: "error",
      message: "GEMINI_API_KEY is not configured."
    });
  }

  try {
    /* ========================================================
       REQUEST
    ======================================================== */

    const body = req.body || {};
    const article = body.article;

    if (!article || !article.title) {
      return res.status(400).json({
        status: "error",
        message: "Article data is required."
      });
    }

    const title =
      String(article.title || "").trim();

    const description =
      String(article.description || "").trim();

    const source =
      String(article.source || "Unknown").trim();

    const author =
      String(article.author || "Unknown").trim();

    const url =
      String(article.url || "").trim();

    const publishedAt =
      String(article.publishedAt || "").trim();

    /* ========================================================
       RESEARCH PROMPT
    ======================================================== */

    const researchPrompt = `
You are NEWSFORGE AI, a professional news research,
fact-checking and editorial intelligence engine.

Your task is to independently investigate the supplied
news story using CURRENT WEB INFORMATION.

You have access to:
1. Google Search for current web reporting.
2. URL Context for reading public article URLs.

IMPORTANT RESEARCH RULES:

- Search the web before making your assessment.
- Do NOT assume the supplied article is correct.
- Investigate the headline and the major claims.
- Search for multiple independent reports.
- Prefer primary sources whenever available.
- Prefer official government websites, police statements,
  court records, company statements, regulatory filings,
  official institutions and direct statements.
- Use established news organizations for independent
  confirmation.
- Distinguish reporting from speculation.
- Do not invent facts.
- Do not invent sources.
- Do not invent quotes.
- Do not invent statistics.
- Do not invent URLs.
- Do not treat a single article as sufficient confirmation
  for an important claim.
- If the original URL is publicly accessible, inspect it
  with URL Context.
- Search for independent reporting even when the original
  article appears credible.
- Identify important disagreements between sources.
- Identify claims that cannot currently be confirmed.
- Pay particular attention to dates and chronology.

HIGH-RISK STORIES:

For stories involving:
- deaths
- disasters
- crime
- accidents
- politics
- elections
- allegations
- communal issues
- medical claims
- financial claims
- national security
- military activity
- public figures

use a substantially more cautious standard.

STATUS DEFINITIONS:

VERIFIED:
Available searched evidence strongly supports the core
claim.

REVIEW:
Evidence exists, but human editorial verification is
still recommended.

UNVERIFIED:
Reliable evidence is insufficient to establish the claim.

CONFLICTED:
Credible sources materially disagree.

IMPORTANT:

"VERIFIED" does NOT mean absolute truth.

It means that the currently available searched evidence
strongly supports the core claim.

Always recommend human review for sensitive breaking news.

============================================================
NEWS STORY
============================================================

HEADLINE:
${title}

DESCRIPTION:
${description}

SOURCE:
${source}

AUTHOR:
${author}

PUBLISHED:
${publishedAt}

ORIGINAL URL:
${url || "No URL supplied"}

============================================================
RESEARCH TASK
============================================================

Perform a detailed investigation.

You should:

1. Search for the exact headline.
2. Search important unique phrases from the story.
3. Search for independent reporting.
4. Check official or primary sources where relevant.
5. Compare dates and chronology.
6. Identify the major factual claims.
7. Assess each claim individually.
8. Identify supporting evidence.
9. Identify conflicting evidence.
10. Identify editorial risk flags.
11. Produce an overall research status.
12. Produce a confidence score from 0 to 100.
13. Give a concise editorial recommendation.

Return ONLY valid JSON matching the supplied schema.
`;

    /* ========================================================
       GEMINI REQUEST
       ======================================================== */

    const geminiResponse = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/interactions",
      {
        method: "POST",

        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": GEMINI_API_KEY
        },

        body: JSON.stringify({
          model: "gemini-3.6-flash",

          input: researchPrompt,

          /*
            IMPORTANT:
            Current Interactions API uses the simple
            google_search declaration.

            Do NOT add the older search_types property.
          */

          tools: [
            {
              type: "google_search"
            },

            {
              type: "url_context"
            }
          ],

          /*
            Structured JSON output.
          */

          response_format: {
            type: "text",

            mime_type: "application/json",

            schema: {
              type: "object",

              properties: {

                research_status: {
                  type: "string",

                  enum: [
                    "VERIFIED",
                    "REVIEW",
                    "UNVERIFIED",
                    "CONFLICTED"
                  ]
                },

                confidence: {
                  type: "integer",

                  minimum: 0,

                  maximum: 100
                },

                executive_summary: {
                  type: "string"
                },

                source_assessment: {
                  type: "string"
                },

                cross_check_summary: {
                  type: "string"
                },

                key_claims: {
                  type: "array",

                  items: {
                    type: "object",

                    properties: {

                      claim: {
                        type: "string"
                      },

                      assessment: {
                        type: "string",

                        enum: [
                          "SUPPORTED",
                          "PARTIALLY_SUPPORTED",
                          "UNSUPPORTED",
                          "CONFLICTED"
                        ]
                      },

                      explanation: {
                        type: "string"
                      }
                    },

                    required: [
                      "claim",
                      "assessment",
                      "explanation"
                    ]
                  }
                },

                supporting_evidence: {
                  type: "array",

                  items: {
                    type: "string"
                  }
                },

                conflicting_evidence: {
                  type: "array",

                  items: {
                    type: "string"
                  }
                },

                risk_flags: {
                  type: "array",

                  items: {
                    type: "string"
                  }
                },

                recommendation: {
                  type: "string"
                }
              },

              required: [
                "research_status",
                "confidence",
                "executive_summary",
                "source_assessment",
                "cross_check_summary",
                "key_claims",
                "supporting_evidence",
                "conflicting_evidence",
                "risk_flags",
                "recommendation"
              ]
            }
          },

          store: false
        })
      }
    );

    /* ========================================================
       READ GEMINI RESPONSE
    ======================================================== */

    const rawResponseText =
      await geminiResponse.text();

    let data = null;

    try {
      data = rawResponseText
        ? JSON.parse(rawResponseText)
        : null;
    } catch (parseError) {

      console.error(
        "Gemini response JSON parse error:",
        parseError
      );

      console.error(
        "Raw Gemini response:",
        rawResponseText
      );

      return res.status(502).json({
        status: "error",
        message: "Gemini returned an invalid API response.",
        details: rawResponseText
          ? rawResponseText.substring(0, 1500)
          : "Empty Gemini response."
      });
    }

    /* ========================================================
       GEMINI API ERROR
    ======================================================== */

    if (!geminiResponse.ok) {

      console.error(
        "Gemini research API error:",
        JSON.stringify(data, null, 2)
      );

      const geminiMessage =
        data &&
        data.error &&
        data.error.message
          ? data.error.message
          : "Unknown Gemini API error.";

      return res.status(geminiResponse.status).json({
        status: "error",

        message:
          "Gemini research request failed.",

        details:
          geminiMessage
      });
    }

    /* ========================================================
       INTERACTION STATUS
    ======================================================== */

    if (
      data &&
      data.status &&
      data.status !== "completed"
    ) {

      console.error(
        "Unexpected Gemini interaction status:",
        data.status
      );

      return res.status(502).json({
        status: "error",

        message:
          "Gemini research interaction did not complete.",

        details:
          "Gemini interaction status: " +
          data.status
      });
    }

    /* ========================================================
       EXTRACT MODEL OUTPUT
    ======================================================== */

    let outputText = "";

    /*
      Preferred modern field.
    */

    if (
      data &&
      typeof data.output_text === "string"
    ) {

      outputText =
        data.output_text;
    }

    /*
      Fallback for the current
      steps[].content[].text structure.
    */

    if (
      !outputText &&
      data &&
      Array.isArray(data.steps)
    ) {

      for (
        const step of data.steps
      ) {

        if (
          !step ||
          step.type !== "model_output" ||
          !Array.isArray(step.content)
        ) {
          continue;
        }

        for (
          const content of step.content
        ) {

          if (
            content &&
            content.type === "text" &&
            typeof content.text === "string"
          ) {

            outputText +=
              content.text;
          }
        }
      }
    }

    outputText =
      String(outputText || "").trim();

    /* ========================================================
       EMPTY OUTPUT
    ======================================================== */

    if (!outputText) {

      console.error(
        "Gemini returned no model output.",
        JSON.stringify(data, null, 2)
      );

      return res.status(502).json({
        status: "error",

        message:
          "Gemini returned an empty research response.",

        details:
          "No model_output text was found in the interaction."
      });
    }

    /* ========================================================
       PARSE RESEARCH JSON
    ======================================================== */

    let research = null;

    try {

      research =
        JSON.parse(outputText);

    } catch (parseError) {

      console.error(
        "NEWSFORGE research JSON parse error:",
        parseError
      );

      console.error(
        "Gemini output:",
        outputText
      );

      /*
        Small recovery attempt in case the model
        unexpectedly surrounds JSON with markdown.
      */

      let cleaned =
        outputText
          .replace(/^```json\s*/i, "")
          .replace(/^```\s*/i, "")
          .replace(/\s*```$/i, "")
          .trim();

      try {

        research =
          JSON.parse(cleaned);

      } catch (secondParseError) {

        return res.status(502).json({
          status: "error",

          message:
            "Gemini returned invalid research JSON.",

          details:
            "The model response could not be parsed as JSON."
        });
      }
    }

    /* ========================================================
       NORMALIZE RESEARCH DATA
    ======================================================== */

    if (
      !research ||
      typeof research !== "object"
    ) {

      return res.status(502).json({
        status: "error",

        message:
          "Gemini returned an invalid research object."
      });
    }

    const validStatuses = [
      "VERIFIED",
      "REVIEW",
      "UNVERIFIED",
      "CONFLICTED"
    ];

    const researchStatus =
      validStatuses.includes(
        String(
          research.research_status || ""
        ).toUpperCase()
      )
        ? String(
            research.research_status
          ).toUpperCase()
        : "REVIEW";

    let confidence =
      Number(
        research.confidence
      );

    if (
      !Number.isFinite(confidence)
    ) {
      confidence = 0;
    }

    confidence =
      Math.max(
        0,
        Math.min(
          100,
          Math.round(confidence)
        )
      );

    const normalizedResearch = {

      research_status:
        researchStatus,

      confidence,

      executive_summary:
        String(
          research.executive_summary ||
          "No executive summary was returned."
        ),

      source_assessment:
        String(
          research.source_assessment ||
          "No source assessment was returned."
        ),

      cross_check_summary:
        String(
          research.cross_check_summary ||
          "No cross-check summary was returned."
        ),

      key_claims:
        Array.isArray(
          research.key_claims
        )
          ? research.key_claims
          : [],

      supporting_evidence:
        Array.isArray(
          research.supporting_evidence
        )
          ? research.supporting_evidence
          : [],

      conflicting_evidence:
        Array.isArray(
          research.conflicting_evidence
        )
          ? research.conflicting_evidence
          : [],

      risk_flags:
        Array.isArray(
          research.risk_flags
        )
          ? research.risk_flags
          : [],

      recommendation:
        String(
          research.recommendation ||
          "Human editorial review is recommended before publication."
        )
    };

    /* ========================================================
       EXTRACT WEB SOURCES
    ======================================================== */

    const sources = [];

    if (
      data &&
      Array.isArray(data.steps)
    ) {

      for (
        const step of data.steps
      ) {

        if (
          !step ||
          !Array.isArray(step.content)
        ) {
          continue;
        }

        for (
          const content of step.content
        ) {

          if (
            !content ||
            !Array.isArray(content.annotations)
          ) {
            continue;
          }

          for (
            const annotation of content.annotations
          ) {

            if (
              annotation &&
              annotation.type === "url_citation" &&
              annotation.url
            ) {

              sources.push({

                title:
                  annotation.title ||
                  annotation.url,

                url:
                  annotation.url
              });

            }
          }
        }
      }
    }

    /* ========================================================
       ADD ORIGINAL SOURCE
       Only if a real URL exists.
    ======================================================== */

    if (url) {

      sources.unshift({

        title:
          source + " · Original article",

        url
      });
    }

    /* ========================================================
       DEDUPLICATE SOURCES
    ======================================================== */

    const uniqueSources = [];

    const seenUrls =
      new Set();

    for (
      const sourceItem of sources
    ) {

      if (
        !sourceItem ||
        !sourceItem.url
      ) {
        continue;
      }

      const normalizedUrl =
        String(
          sourceItem.url
        ).trim();

      if (
        !normalizedUrl ||
        seenUrls.has(normalizedUrl)
      ) {
        continue;
      }

      seenUrls.add(
        normalizedUrl
      );

      uniqueSources.push({

        title:
          String(
            sourceItem.title ||
            normalizedUrl
          ),

        url:
          normalizedUrl
      });
    }

    /* ========================================================
       FINAL RESPONSE
    ======================================================== */

    return res.status(200).json({

      status: "success",

      research: {

        ...normalizedResearch,

        sources:
          uniqueSources,

        researchedAt:
          new Date().toISOString(),

        story: {

          title,

          source,

          author,

          publishedAt,

          url
        }
      }
    });

  } catch (error) {

    console.error(
      "NEWSFORGE research engine exception:",
      error
    );

    return res.status(500).json({

      status: "error",

      message:
        "Research engine failed.",

      details:
        error &&
        error.message
          ? error.message
          : "Unknown server error."
    });
  }
}
