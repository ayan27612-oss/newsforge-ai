export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");

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
    const body = req.body || {};
    const article = body.article;

    if (!article || !article.title) {
      return res.status(400).json({
        status: "error",
        message: "Article data is required."
      });
    }

    const title = article.title || "";
    const description = article.description || "";
    const source = article.source || "Unknown";
    const author = article.author || "Unknown";
    const url = article.url || "";
    const publishedAt = article.publishedAt || "";

    const researchPrompt = `
You are NEWSFORGE AI, a professional news research and verification engine.

Your job is to investigate the following news story using CURRENT WEB INFORMATION.

IMPORTANT:
- Search the web for the story and related reporting.
- Do not assume the supplied article is correct.
- Cross-check important claims across multiple independent sources.
- Prefer primary sources, official institutions, government websites, established news organizations, and direct statements.
- Identify disagreements between sources.
- Do not invent facts, sources, quotes, statistics, or URLs.
- If evidence is insufficient, say so clearly.
- Breaking news, deaths, disasters, crime, politics, elections, allegations, medical claims and communal issues require especially cautious treatment.
- "VERIFIED" does NOT mean absolute truth. It means the available searched evidence strongly supports the core claim.
- "REVIEW" means evidence exists but human verification is still recommended.
- "UNVERIFIED" means there is insufficient reliable evidence.
- "CONFLICTED" means credible sources materially disagree.

NEWS STORY:

Headline:
${title}

Description:
${description}

Source:
${source}

Author:
${author}

Published:
${publishedAt}

Original URL:
${url}

Perform a detailed research investigation.

Return ONLY valid JSON matching the requested schema.
`;

    const response = await fetch(
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

          tools: [
            {
              type: "google_search",
              search_types: ["web_search"]
            },
            {
              type: "url_context"
            }
          ],

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

    const data = await response.json();

    if (!response.ok) {
      console.error("Gemini research error:", data);

      return res.status(response.status).json({
        status: "error",
        message: "Gemini research request failed.",
        details: data?.error?.message || "Unknown Gemini error."
      });
    }

    /*
      Current Gemini Interactions API returns model output
      inside steps[].content[].text.
    */

    let outputText = "";

    if (typeof data.output_text === "string") {
      outputText = data.output_text;
    }

    if (!outputText && Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (
          step &&
          step.type === "model_output" &&
          Array.isArray(step.content)
        ) {
          for (const content of step.content) {
            if (
              content &&
              content.type === "text" &&
              typeof content.text === "string"
            ) {
              outputText += content.text;
            }
          }
        }
      }
    }

    if (!outputText) {
      return res.status(502).json({
        status: "error",
        message: "Gemini returned an empty research response."
      });
    }

    let research;

    try {
      research = JSON.parse(outputText);
    } catch (parseError) {
      console.error("Research JSON parse error:", parseError);
      console.error("Gemini output:", outputText);

      return res.status(502).json({
        status: "error",
        message: "Gemini returned invalid research JSON."
      });
    }

    /*
      Extract web citations from Gemini's model output.
    */

    const sources = [];

    if (Array.isArray(data.steps)) {
      for (const step of data.steps) {
        if (
          step &&
          step.type === "model_output" &&
          Array.isArray(step.content)
        ) {
          for (const content of step.content) {
            if (
              content &&
              Array.isArray(content.annotations)
            ) {
              for (const annotation of content.annotations) {
                if (
                  annotation &&
                  annotation.type === "url_citation" &&
                  annotation.url
                ) {
                  sources.push({
                    title:
                      annotation.title ||
                      annotation.url,
                    url: annotation.url
                  });
                }
              }
            }
          }
        }
      }
    }

    /*
      Remove duplicate sources.
    */

    const uniqueSources = [];
    const seenUrls = new Set();

    for (const sourceItem of sources) {
      if (!seenUrls.has(sourceItem.url)) {
        seenUrls.add(sourceItem.url);
        uniqueSources.push(sourceItem);
      }
    }

    return res.status(200).json({
      status: "success",

      research: {
        ...research,

        sources: uniqueSources,

        researchedAt: new Date().toISOString(),

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
    console.error("NEWSFORGE research error:", error);

    return res.status(500).json({
      status: "error",
      message: "Research engine failed.",
      details: error.message
    });
  }
}
