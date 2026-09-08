export default async function handler(req, res) {
  try {
    // =========================================================
    // NEWSFORGE AI ENGINE
    // =========================================================

    const newsApiKey = process.env.NEWS_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;

    // =========================================================
    // 1. CHECK API KEYS
    // =========================================================

    if (!newsApiKey) {
      return res.status(500).json({
        status: "error",
        message: "NEWS_API_KEY is not configured on the server."
      });
    }

    if (!geminiApiKey) {
      return res.status(500).json({
        status: "error",
        message: "GEMINI_API_KEY is not configured on the server."
      });
    }

    // =========================================================
    // 2. REQUEST PARAMETERS
    // =========================================================

    const {
      q,
      pageSize = "20",
      language = "en",
      sortBy = "publishedAt"
    } = req.query;

    // =========================================================
    // 3. INDIA-FOCUSED SEARCH
    // =========================================================

    const searchQuery =
      q && String(q).trim()
        ? String(q).trim()
        : "(India OR Indian OR Delhi OR Mumbai OR Bengaluru OR Hyderabad OR Chennai OR Kolkata OR Pune OR Maharashtra OR Karnataka OR Gujarat)";

    // =========================================================
    // 4. SAFE PAGE SIZE
    // =========================================================

    const requestedPageSize = Number(pageSize);

    const safePageSize = Math.min(
      Math.max(
        Number.isFinite(requestedPageSize)
          ? requestedPageSize
          : 20,
        1
      ),
      20
    );

    // =========================================================
    // 5. BUILD NEWSAPI REQUEST
    // =========================================================

    const newsParams = new URLSearchParams();

    newsParams.set("q", searchQuery);
    newsParams.set("language", language);
    newsParams.set("sortBy", sortBy);
    newsParams.set("pageSize", String(safePageSize));

    const newsApiUrl =
      `https://newsapi.org/v2/everything?${newsParams.toString()}`;

    // =========================================================
    // 6. FETCH NEWS
    // =========================================================

    const newsResponse = await fetch(newsApiUrl, {
      method: "GET",
      headers: {
        "X-Api-Key": newsApiKey,
        "Accept": "application/json"
      }
    });

    const newsData = await newsResponse.json();

    // =========================================================
    // 7. NEWSAPI ERROR
    // =========================================================

    if (
      !newsResponse.ok ||
      newsData.status !== "ok"
    ) {
      console.error(
        "NEWSFORGE NewsAPI Error:",
        newsData
      );

      return res.status(
        newsResponse.status || 500
      ).json({
        status: "error",
        source: "NewsAPI",
        message:
          newsData.message ||
          "NewsAPI request failed.",
        code:
          newsData.code ||
          "NEWS_API_ERROR"
      });
    }

    // =========================================================
    // 8. NORMALIZE ARTICLES
    // =========================================================

    const articles =
      (newsData.articles || [])
        .filter(
          article =>
            article &&
            article.title &&
            article.title !== "[Removed]"
        )
        .map(
          (article, index) => ({
            id: index + 1,

            source:
              article.source?.name ||
              "Unknown Source",

            author:
              article.author ||
              null,

            title:
              article.title ||
              "Untitled Story",

            description:
              article.description ||
              "No description available.",

            url:
              article.url ||
              null,

            image:
              article.urlToImage ||
              null,

            publishedAt:
              article.publishedAt ||
              null,

            content:
              article.content ||
              null
          })
        );

    // =========================================================
    // 9. NO ARTICLES
    // =========================================================

    if (articles.length === 0) {
      return res.status(200).json({
        status: "success",

        source: "NewsAPI",

        ai: {
          enabled: true,
          provider: "Google Gemini",
          model: "gemini-3.6-flash",
          analyzed: false
        },

        country: "in",

        query: searchQuery,

        totalResults: 0,

        fetchedAt:
          new Date().toISOString(),

        articles: []
      });
    }

    // =========================================================
    // 10. PREPARE STORIES FOR GEMINI
    // =========================================================

    const storiesForAI =
      articles.map(article => ({
        id: article.id,
        source: article.source,
        title: article.title,
        description: article.description,
        publishedAt: article.publishedAt
      }));

    // =========================================================
    // 11. GEMINI INSTRUCTIONS
    // =========================================================

    const systemInstruction = `
You are NEWSFORGE AI, an editorial intelligence engine.

Analyze the supplied news stories for an Indian audience.

Do NOT invent facts.

The trend score represents attention and importance potential,
not factual certainty.

For every story return:

id
trendScore
category
priority
audienceRelevance
attentionPotential
humanVerificationRequired
reasoning

Trend score:

90-100 = Extremely high potential
80-89 = Very high potential
70-79 = High potential
60-69 = Moderate potential
40-59 = Low potential
0-39 = Very low potential

Allowed categories:

Business
Technology
Politics
World
India
Sports
Science
Entertainment
Health
Finance
Education
Crime
Environment
Other

Allowed priority:

critical
high
medium
low

humanVerificationRequired MUST be true for:

deaths
disasters
crime
allegations
political claims
elections
communal issues
religious issues
medical claims
financial claims
rapidly developing events
potentially harmful misinformation

Return valid JSON only.
`;

    // =========================================================
    // 12. GEMINI USER INPUT
    // =========================================================

    const userPrompt = `
Analyze the following news stories.

Return one analysis object for every story.

Stories:

${JSON.stringify(
  storiesForAI,
  null,
  2
)}
`;

    // =========================================================
    // 13. STRUCTURED OUTPUT SCHEMA
    //
    // We wrap the array inside an object because the
    // Interactions API structured-output format is designed
    // around JSON objects.
    // =========================================================

    const responseSchema = {
      type: "object",

      properties: {
        analyses: {
          type: "array",

          items: {
            type: "object",

            properties: {
              id: {
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
                type: "string"
              },

              attentionPotential: {
                type: "boolean"
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
        "analyses"
      ]
    };

    // =========================================================
    // 14. GEMINI INTERACTIONS API
    // =========================================================

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/interactions";

    const geminiPayload = {
      model: "gemini-3.6-flash",

      system_instruction:
        systemInstruction,

      input:
        userPrompt,

      response_format: {
        type: "text",

        mime_type:
          "application/json",

        schema:
          responseSchema
      },

      store: false
    };

    // =========================================================
    // 15. CALL GEMINI
    // =========================================================

    const geminiResponse =
      await fetch(
        geminiUrl,
        {
          method: "POST",

          headers: {
            "Content-Type":
              "application/json",

            "x-goog-api-key":
              geminiApiKey
          },

          body:
            JSON.stringify(
              geminiPayload
            )
        }
      );

    const geminiData =
      await geminiResponse.json();

    // =========================================================
    // 16. GEMINI HTTP ERROR
    // =========================================================

    if (!geminiResponse.ok) {
      console.error(
        "NEWSFORGE Gemini HTTP Error:",
        geminiData
      );

      return res.status(
        geminiResponse.status || 500
      ).json({
        status: "error",

        source: "Gemini",

        message:
          geminiData?.error?.message ||
          "Gemini AI request failed.",

        code:
          geminiData?.error?.status ||
          "GEMINI_API_ERROR"
      });
    }

    // =========================================================
    // 17. EXTRACT GEMINI TEXT
    //
    // IMPORTANT:
    //
    // REST Interactions API returns model output inside:
    //
    // steps[]
    //   → type: model_output
    //   → content[]
    //   → type: text
    //
    // SDKs expose output_text as convenience.
    // We support BOTH formats here.
    // =========================================================

    let aiText = "";

    // ---------------------------------------------------------
    // A. SDK-style output_text fallback
    // ---------------------------------------------------------

    if (
      typeof geminiData.output_text ===
      "string"
    ) {
      aiText =
        geminiData.output_text.trim();
    }

    // ---------------------------------------------------------
    // B. REST steps response
    // ---------------------------------------------------------

    if (!aiText && Array.isArray(geminiData.steps)) {

      for (
        const step
        of geminiData.steps
      ) {

        if (
          step?.type ===
          "model_output"
        ) {

          const content =
            Array.isArray(
              step.content
            )
              ? step.content
              : [];

          const textParts =
            content
              .filter(
                item =>
                  item?.type ===
                  "text"
              )
              .map(
                item =>
                  item.text || ""
              );

          if (
            textParts.length > 0
          ) {
            aiText =
              textParts
                .join("")
                .trim();

            break;
          }
        }
      }
    }

    // =========================================================
    // 18. HANDLE EMPTY RESPONSE
    // =========================================================

    if (!aiText) {

      console.error(
        "NEWSFORGE Gemini returned no readable model output.",
        geminiData
      );

      return res.status(500).json({
        status: "error",

        source: "Gemini",

        message:
          "Gemini returned no readable model output.",

        debug: {
          interactionId:
            geminiData?.id ||
            null,

          interactionStatus:
            geminiData?.status ||
            null,

          stepCount:
            Array.isArray(
              geminiData?.steps
            )
              ? geminiData.steps.length
              : 0
        }
      });
    }

    // =========================================================
    // 19. PARSE AI JSON
    // =========================================================

    let parsedAI;

    try {

      parsedAI =
        JSON.parse(
          aiText
        );

    } catch (error) {

      console.error(
        "NEWSFORGE Gemini JSON Parse Error:",
        error
      );

      console.error(
        "Gemini raw output:",
        aiText
      );

      return res.status(500).json({
        status: "error",

        source: "Gemini",

        message:
          "Gemini returned invalid JSON.",

        rawOutput:
          aiText.substring(
            0,
            2000
          )
      });
    }

    // =========================================================
    // 20. EXTRACT ANALYSES
    // =========================================================

    const aiAnalyses =
      Array.isArray(
        parsedAI?.analyses
      )
        ? parsedAI.analyses
        : [];

    // =========================================================
    // 21. CREATE LOOKUP MAP
    // =========================================================

    const analysisMap =
      new Map();

    for (
      const analysis
      of aiAnalyses
    ) {

      if (
        analysis &&
        analysis.id !== undefined
      ) {

        analysisMap.set(
          Number(
            analysis.id
          ),
          analysis
        );
      }
    }

    // =========================================================
    // 22. MERGE NEWS + AI INTELLIGENCE
    // =========================================================

    const allowedCategories = [
      "Business",
      "Technology",
      "Politics",
      "World",
      "India",
      "Sports",
      "Science",
      "Entertainment",
      "Health",
      "Finance",
      "Education",
      "Crime",
      "Environment",
      "Other"
    ];

    const allowedPriorities = [
      "critical",
      "high",
      "medium",
      "low"
    ];

    const enrichedArticles =
      articles.map(article => {

        const ai =
          analysisMap.get(
            Number(article.id)
          ) || {};

        let trendScore =
          Number(
            ai.trendScore
          );

        if (
          !Number.isFinite(
            trendScore
          )
        ) {
          trendScore = 0;
        }

        trendScore =
          Math.min(
            Math.max(
              Math.round(
                trendScore
              ),
              0
            ),
            100
          );

        const category =
          allowedCategories.includes(
            ai.category
          )
            ? ai.category
            : "Other";

        const priority =
          allowedPriorities.includes(
            ai.priority
          )
            ? ai.priority
            : (
                trendScore >= 90
                  ? "critical"
                  : trendScore >= 80
                    ? "high"
                    : trendScore >= 60
                      ? "medium"
                      : "low"
              );

        return {
          ...article,

          ai: {
            trendScore,

            category,

            priority,

            audienceRelevance:
              ai.audienceRelevance ||
              "Unknown",

            attentionPotential:
              Boolean(
                ai.attentionPotential
              ),

            humanVerificationRequired:
              ai.humanVerificationRequired !==
              false,

            reasoning:
              ai.reasoning ||
              "No AI reasoning available."
          }
        };
      });

    // =========================================================
    // 23. SORT BY TREND SCORE
    // =========================================================

    enrichedArticles.sort(
      (a, b) =>
        (
          b.ai?.trendScore ||
          0
        ) -
        (
          a.ai?.trendScore ||
          0
        )
    );

    // =========================================================
    // 24. METRICS
    // =========================================================

    const highPotential =
      enrichedArticles.filter(
        article =>
          (
            article.ai?.trendScore ||
            0
          ) >= 80
      ).length;

    const criticalStories =
      enrichedArticles.filter(
        article =>
          article.ai?.priority ===
          "critical"
      ).length;

    const verificationRequired =
      enrichedArticles.filter(
        article =>
          article.ai
            ?.humanVerificationRequired
      ).length;

    // =========================================================
    // 25. SUCCESS RESPONSE
    // =========================================================

    return res.status(200).json({

      status:
        "success",

      source:
        "NewsAPI",

      ai: {

        enabled:
          true,

        provider:
          "Google Gemini",

        model:
          "gemini-3.6-flash",

        analyzed:
          true,

        analyzedStories:
          enrichedArticles.length,

        highPotential,

        criticalStories,

        verificationRequired
      },

      country:
        "in",

      query:
        searchQuery,

      totalResults:
        newsData.totalResults ||
        articles.length,

      fetchedAt:
        new Date().toISOString(),

      articles:
        enrichedArticles
    });

  } catch (error) {

    // =========================================================
    // GLOBAL ERROR
    // =========================================================

    console.error(
      "NEWSFORGE AI Engine Error:",
      error
    );

    return res.status(500).json({

      status:
        "error",

      message:
        "NEWSFORGE AI Engine failed.",

      error:
        error?.message ||
        "Unknown server error."
    });
  }
}
