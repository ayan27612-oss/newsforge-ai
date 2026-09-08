export default async function handler(req, res) {
  try {
    // =========================================================
    // NEWSFORGE AI NEWS INTELLIGENCE ENGINE
    //
    // Pipeline:
    // NewsAPI
    //    ↓
    // Real news articles
    //    ↓
    // Gemini AI
    //    ↓
    // Trend analysis
    //    ↓
    // Score / category / priority / reasoning
    // =========================================================


    // =========================================================
    // 1. READ SERVER-SIDE API KEYS
    // =========================================================

    const newsApiKey = process.env.NEWS_API_KEY;
    const geminiApiKey = process.env.GEMINI_API_KEY;


    // =========================================================
    // 2. CHECK NEWS API KEY
    // =========================================================

    if (!newsApiKey) {
      return res.status(500).json({
        status: "error",
        message: "NEWS_API_KEY is not configured on the server."
      });
    }


    // =========================================================
    // 3. CHECK GEMINI API KEY
    // =========================================================

    if (!geminiApiKey) {
      return res.status(500).json({
        status: "error",
        message: "GEMINI_API_KEY is not configured on the server."
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
    // 5. INDIA-FOCUSED DEFAULT SEARCH
    // =========================================================

    const searchQuery =
      q && String(q).trim()
        ? String(q).trim()
        : "(India OR Indian OR Delhi OR Mumbai OR Bengaluru OR Hyderabad OR Chennai OR Kolkata OR Pune OR Gujarat OR Maharashtra OR Karnataka)";


    // =========================================================
    // 6. PROTECT NEWSAPI REQUEST SIZE
    // =========================================================

    const requestedPageSize = Number(pageSize);

    const safePageSize = Math.min(
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

    const newsParams = new URLSearchParams();

    newsParams.set("q", searchQuery);
    newsParams.set("language", language);
    newsParams.set("sortBy", sortBy);
    newsParams.set("pageSize", String(safePageSize));


    const newsApiUrl =
      `https://newsapi.org/v2/everything?${newsParams.toString()}`;


    // =========================================================
    // 8. FETCH REAL NEWS
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
    // 9. HANDLE NEWSAPI ERROR
    // =========================================================

    if (
      !newsResponse.ok ||
      newsData.status !== "ok"
    ) {
      console.error(
        "NewsAPI Error:",
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
    // 10. NORMALIZE NEWS ARTICLES
    // =========================================================

    const articles = (newsData.articles || [])
      .filter(
        article =>
          article &&
          article.title &&
          article.title !== "[Removed]"
      )
      .map((article, index) => ({
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
      }));


    // =========================================================
    // 11. IF NO ARTICLES WERE FOUND
    // =========================================================

    if (articles.length === 0) {
      return res.status(200).json({
        status: "success",

        source: "NewsAPI",

        ai: {
          enabled: true,
          analyzed: false,
          model: "gemini-2.5-flash"
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
    // 12. PREPARE STORIES FOR GEMINI
    //
    // We intentionally send only useful text.
    // This keeps the request smaller and helps the
    // free tier last longer.
    // =========================================================

    const storiesForAI = articles.map(article => ({
      id: article.id,

      source: article.source,

      title: article.title,

      description:
        article.description,

      publishedAt:
        article.publishedAt
    }));


    // =========================================================
    // 13. GEMINI SYSTEM INSTRUCTION
    // =========================================================

    const systemInstruction = `
You are NEWSFORGE AI, an editorial intelligence engine.

Your job is to analyze real news articles and identify which stories
have the strongest potential to matter to an Indian audience.

You are NOT a journalist and you must NOT invent facts.

Only use information contained in the supplied article metadata.

For every article:

1. Assign a trend score from 0 to 100.
2. Assign a category.
3. Assign a priority level.
4. Estimate audience relevance.
5. Explain briefly why the story matters.
6. Identify whether the story appears to have high attention potential.
7. Identify whether the story requires human verification before publishing.

Trend score guidance:

90-100 = Extremely important / potentially major national or global story
80-89  = Very strong attention potential
70-79  = Strong story
60-69  = Moderate potential
40-59  = Low-to-moderate potential
0-39   = Low potential

Categories should be one of:

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

Priority should be one of:

critical
high
medium
low

Human verification should be true for stories involving:

- deaths
- disasters
- crime allegations
- political claims
- elections
- communal or religious issues
- medical claims
- financial claims
- allegations
- rapidly developing events
- information that could cause serious public harm if wrong

Do not treat the trend score as a factual claim.

Return ONLY valid JSON.
`;


    // =========================================================
    // 14. GEMINI USER PROMPT
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
    // 15. GEMINI REQUEST
    //
    // Official Gemini REST API
    // =========================================================

    const geminiUrl =
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";


    const geminiPayload = {
      system_instruction: {
        parts: [
          {
            text: systemInstruction
          }
        ]
      },

      contents: [
        {
          role: "user",

          parts: [
            {
              text: userPrompt
            }
          ]
        }
      ],

      generationConfig: {
        temperature: 0.2,

        responseMimeType:
          "application/json"
      }
    };


    // =========================================================
    // 16. CALL GEMINI
    // =========================================================

    const geminiResponse = await fetch(
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
    // 17. HANDLE GEMINI ERROR
    // =========================================================

    if (!geminiResponse.ok) {
      console.error(
        "Gemini API Error:",
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
    // 18. EXTRACT GEMINI TEXT
    // =========================================================

    const aiText =
      geminiData?.candidates?.[0]
        ?.content
        ?.parts
        ?.map(part => part.text || "")
        .join("")
        .trim();


    if (!aiText) {
      console.error(
        "Gemini returned no usable text:",
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
    // 19. PARSE GEMINI JSON
    // =========================================================

    let aiAnalyses;

    try {
      aiAnalyses =
        JSON.parse(aiText);

    } catch (parseError) {

      console.error(
        "Gemini JSON Parse Error:",
        parseError
      );

      console.error(
        "Gemini Raw Response:",
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
    // 20. NORMALIZE AI RESPONSE
    // =========================================================

    if (!Array.isArray(aiAnalyses)) {
      aiAnalyses = [];
    }


    // =========================================================
    // 21. CREATE LOOKUP TABLE
    // =========================================================

    const analysisMap =
      new Map();

    for (const analysis of aiAnalyses) {

      if (
        analysis &&
        analysis.id !== undefined
      ) {
        analysisMap.set(
          Number(analysis.id),
          analysis
        );
      }
    }


    // =========================================================
    // 22. MERGE NEWS + AI INTELLIGENCE
    // =========================================================

    const enrichedArticles =
      articles.map(article => {

        const ai =
          analysisMap.get(
            Number(article.id)
          ) || {};


        let trendScore =
          Number(ai.trendScore);


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
          ai.category ||
          "Other";


        const priority =
          ai.priority ||
          (
            trendScore >= 85
              ? "high"
              : trendScore >= 65
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
              "AI analysis unavailable."
          }
        };
      });


    // =========================================================
    // 23. SORT BY AI TREND SCORE
    //
    // Most important stories appear first.
    // =========================================================

    enrichedArticles.sort(
      (a, b) =>
        (
          b.ai?.trendScore || 0
        ) -
        (
          a.ai?.trendScore || 0
        )
    );


    // =========================================================
    // 24. SUMMARY METRICS
    // =========================================================

    const highPotential =
      enrichedArticles.filter(
        article =>
          (
            article.ai?.trendScore || 0
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
    // 25. FINAL NEWSFORGE RESPONSE
    // =========================================================

    return res.status(200).json({

      status: "success",

      source: "NewsAPI",

      ai: {
        enabled: true,

        provider: "Google Gemini",

        model:
          "gemini-2.5-flash",

        analyzed: true,

        analyzedStories:
          enrichedArticles.length,

        highPotential,

        criticalStories,

        verificationRequired
      },

      country: "in",

      query: searchQuery,

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
    // 26. GLOBAL ERROR HANDLER
    // =========================================================

    console.error(
      "NEWSFORGE AI Engine Error:",
      error
    );


    return res.status(500).json({

      status: "error",

      message:
        "NEWSFORGE AI Engine failed.",

      error:
        error?.message ||
        "Unknown server error."
    });
  }
}
