export default async function handler(req, res) {
  try {
    // =========================================================
    // NEWSFORGE AI
    // Real News Discovery + Gemini Trend Intelligence
    //
    // Pipeline:
    //
    // NewsAPI
    //     ↓
    // Real news articles
    //     ↓
    // Gemini 3.6 Flash
    //     ↓
    // AI trend analysis
    //     ↓
    // Trend score / category / priority
    //     ↓
    // NEWSFORGE dashboard
    // =========================================================


    // =========================================================
    // 1. SERVER-SIDE API KEYS
    // =========================================================

    const newsApiKey = process.env.NEWS_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;


    // =========================================================
    // 2. CHECK NEWSAPI KEY
    // =========================================================

    if (!newsApiKey) {
      return res.status(500).json({
        status: "error",
        message:
          "NEWS_API_KEY is not configured on the server."
      });
    }


    // =========================================================
    // 3. CHECK GEMINI KEY
    // =========================================================

    if (!geminiApiKey) {
      return res.status(500).json({
        status: "error",
        message:
          "GEMINI_API_KEY is not configured on the server."
      });
    }


    // =========================================================
    // 4. READ REQUEST PARAMETERS
    // =========================================================

    const {
      q,
      pageSize = "20",
      language = "en",
      sortBy = "publishedAt"
    } = req.query;


    // =========================================================
    // 5. INDIA-FOCUSED DEFAULT QUERY
    // =========================================================

    const searchQuery =
      q && String(q).trim()
        ? String(q).trim()
        : "(India OR Indian OR Delhi OR Mumbai OR Bengaluru OR Hyderabad OR Chennai OR Kolkata OR Pune OR Maharashtra OR Karnataka OR Gujarat)";


    // =========================================================
    // 6. SAFE PAGE SIZE
    // =========================================================

    const requestedPageSize =
      Number(pageSize);

    const safePageSize =
      Math.min(
        Math.max(
          Number.isFinite(requestedPageSize)
            ? requestedPageSize
            : 20,
          1
        ),
        30
      );


    // =========================================================
    // 7. BUILD NEWSAPI REQUEST
    // =========================================================

    const newsParams =
      new URLSearchParams();

    newsParams.set(
      "q",
      searchQuery
    );

    newsParams.set(
      "language",
      language
    );

    newsParams.set(
      "sortBy",
      sortBy
    );

    newsParams.set(
      "pageSize",
      String(safePageSize)
    );


    const newsApiUrl =
      `https://newsapi.org/v2/everything?${newsParams.toString()}`;


    // =========================================================
    // 8. FETCH REAL NEWS
    // =========================================================

    const newsResponse =
      await fetch(
        newsApiUrl,
        {
          method: "GET",

          headers: {
            "X-Api-Key":
              newsApiKey,

            "Accept":
              "application/json"
          }
        }
      );


    const newsData =
      await newsResponse.json();


    // =========================================================
    // 9. HANDLE NEWSAPI ERROR
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
    // 10. NORMALIZE ARTICLES
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
            id:
              index + 1,

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
    // 11. NO NEWS FOUND
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

        query:
          searchQuery,

        totalResults: 0,

        fetchedAt:
          new Date().toISOString(),

        articles: []
      });
    }


    // =========================================================
    // 12. PREPARE DATA FOR GEMINI
    //
    // We don't send unnecessary data.
    // This reduces token usage and keeps the
    // free tier useful for development.
    // =========================================================

    const storiesForAI =
      articles.map(
        article => ({
          id:
            article.id,

          source:
            article.source,

          title:
            article.title,

          description:
            article.description,

          publishedAt:
            article.publishedAt
        })
      );


    // =========================================================
    // 13. NEWSFORGE AI INSTRUCTION
    // =========================================================

    const systemInstruction = `
You are NEWSFORGE AI, an editorial intelligence engine.

Your job is to analyze news article metadata and identify which
stories have the strongest potential to matter to an Indian audience.

IMPORTANT RULES:

1. Do not invent facts.
2. Only use information supplied in the article data.
3. Do not claim that a story is factually true merely because it
   has a high trend score.
4. Trend score represents attention and importance potential,
   not factual certainty.
5. Sensitive stories should require human verification.

For every story return:

- id
- trendScore
- category
- priority
- audienceRelevance
- attentionPotential
- humanVerificationRequired
- reasoning

TREND SCORE:

90-100 = Extremely high potential
80-89  = Very high potential
70-79  = High potential
60-69  = Moderate potential
40-59  = Low potential
0-39   = Very low potential

CATEGORIES:

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

PRIORITY:

critical
high
medium
low

Set humanVerificationRequired to true for stories involving:

- deaths
- disasters
- crime
- allegations
- political claims
- elections
- communal or religious issues
- medical claims
- financial claims
- rapidly developing events
- potentially harmful misinformation

Return ONLY valid JSON matching the requested schema.
`;


    // =========================================================
    // 14. GEMINI INPUT
    // =========================================================

    const userPrompt = `
Analyze these news stories for NEWSFORGE.

Return one analysis object for every story.

NEWS STORIES:

${JSON.stringify(
  storiesForAI,
  null,
  2
)}
`;


    // =========================================================
    // 15. GEMINI STRUCTURED OUTPUT SCHEMA
    //
    // Google Gemini Interactions API supports structured
    // JSON responses through response_format.
    // =========================================================

    const responseSchema = {
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
            type: "string",

            enum: [
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
            ]
          },

          priority: {
            type: "string",

            enum: [
              "critical",
              "high",
              "medium",
              "low"
            ]
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
    };


    // =========================================================
    // 16. GEMINI INTERACTIONS API
    //
    // Current recommended Gemini interface.
    // =========================================================

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/interactions";


    const geminiPayload = {

      model:
        "gemini-3.6-flash",

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

      store:
        false
    };


    // =========================================================
    // 17. CALL GEMINI
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
    // 18. HANDLE GEMINI ERROR
    // =========================================================

    if (!geminiResponse.ok) {

      console.error(
        "NEWSFORGE Gemini Error:",
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
    // 19. EXTRACT GEMINI OUTPUT
    //
    // Interactions API returns the generated text in
    // output_text in the current API structure.
    // =========================================================

    const aiText =
      typeof geminiData.output_text === "string"
        ? geminiData.output_text.trim()
        : "";


    if (!aiText) {

      console.error(
        "Gemini returned no output:",
        geminiData
      );

      return res.status(500).json({

        status: "error",

        source: "Gemini",

        message:
          "Gemini returned an empty AI response."
      });
    }


    // =========================================================
    // 20. PARSE STRUCTURED JSON
    // =========================================================

    let aiAnalyses;

    try {

      aiAnalyses =
        JSON.parse(
          aiText
        );

    } catch (error) {

      console.error(
        "NEWSFORGE Gemini JSON parsing error:",
        error
      );

      console.error(
        "Raw Gemini output:",
        aiText
      );

      return res.status(500).json({

        status: "error",

        source: "Gemini",

        message:
          "Gemini returned invalid JSON."
      });
    }


    // =========================================================
    // 21. NORMALIZE AI RESPONSE
    // =========================================================

    if (
      !Array.isArray(
        aiAnalyses
      )
    ) {

      aiAnalyses = [];
    }


    // =========================================================
    // 22. BUILD AI LOOKUP MAP
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
    // 23. MERGE NEWS + AI
    // =========================================================

    const enrichedArticles =
      articles.map(
        article => {

          const ai =
            analysisMap.get(
              Number(
                article.id
              )
            ) || {};


          // -----------------------------------------------
          // TREND SCORE
          // -----------------------------------------------

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


          // -----------------------------------------------
          // PRIORITY
          // -----------------------------------------------

          let priority =
            ai.priority;


          if (
            ![
              "critical",
              "high",
              "medium",
              "low"
            ].includes(
              priority
            )
          ) {

            priority =
              trendScore >= 90
                ? "critical"
                : trendScore >= 80
                  ? "high"
                  : trendScore >= 60
                    ? "medium"
                    : "low";
          }


          // -----------------------------------------------
          // CATEGORY
          // -----------------------------------------------

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


          const category =
            allowedCategories.includes(
              ai.category
            )
              ? ai.category
              : "Other";


          // -----------------------------------------------
          // FINAL ARTICLE
          // -----------------------------------------------

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
                "AI analysis unavailable."
            }
          };
        }
      );


    // =========================================================
    // 24. SORT STORIES BY TREND SCORE
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
    // 25. CALCULATE INTELLIGENCE METRICS
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
    // 26. FINAL NEWSFORGE RESPONSE
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
    // 27. GLOBAL ERROR HANDLER
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
