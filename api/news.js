export default async function handler(req, res) {
  try {
    const apiKey = process.env.NEWS_API_KEY;

    // ---------------------------------------------------------
    // 1. Check API key
    // ---------------------------------------------------------

    if (!apiKey) {
      return res.status(500).json({
        status: "error",
        message: "NEWS_API_KEY is not configured on the server."
      });
    }

    // ---------------------------------------------------------
    // 2. Read request parameters
    // ---------------------------------------------------------

    const {
      q,
      pageSize = "30",
      language = "en",
      sortBy = "publishedAt"
    } = req.query;

    // ---------------------------------------------------------
    // 3. Default India-focused discovery query
    //
    // If the frontend sends ?q=something, that query is used.
    // Otherwise NEWSFORGE searches for India / Indian news.
    // ---------------------------------------------------------

    const searchQuery =
      q && String(q).trim()
        ? String(q).trim()
        : "(India OR Indian OR Delhi OR Mumbai OR Bengaluru OR Hyderabad OR Chennai OR Kolkata)";

    // ---------------------------------------------------------
    // 4. Protect the API from unreasonable page sizes
    // ---------------------------------------------------------

    const requestedPageSize = Number(pageSize);

    const safePageSize = Math.min(
      Math.max(Number.isFinite(requestedPageSize) ? requestedPageSize : 30, 1),
      50
    );

    // ---------------------------------------------------------
    // 5. Build NewsAPI /everything request
    // ---------------------------------------------------------

    const params = new URLSearchParams();

    params.set("q", searchQuery);
    params.set("language", language);
    params.set("sortBy", sortBy);
    params.set("pageSize", String(safePageSize));

    const newsApiUrl =
      `https://newsapi.org/v2/everything?${params.toString()}`;

    // ---------------------------------------------------------
    // 6. Request news from NewsAPI
    // ---------------------------------------------------------

    const response = await fetch(newsApiUrl, {
      method: "GET",
      headers: {
        "X-Api-Key": apiKey,
        "Accept": "application/json"
      }
    });

    // ---------------------------------------------------------
    // 7. Parse response
    // ---------------------------------------------------------

    const data = await response.json();

    // ---------------------------------------------------------
    // 8. Handle NewsAPI errors
    // ---------------------------------------------------------

    if (!response.ok || data.status !== "ok") {
      console.error("NewsAPI Error:", data);

      return res.status(response.status || 500).json({
        status: "error",
        source: "NewsAPI",
        message: data.message || "NewsAPI request failed.",
        code: data.code || "NEWS_API_ERROR"
      });
    }

    // ---------------------------------------------------------
    // 9. Normalize articles for NEWSFORGE
    // ---------------------------------------------------------

    const articles = (data.articles || [])
      .filter(article => article && article.title)
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

    // ---------------------------------------------------------
    // 10. Return clean NEWSFORGE response
    // ---------------------------------------------------------

    return res.status(200).json({
      status: "success",

      source: "NewsAPI",

      country: "in",

      query: searchQuery,

      totalResults:
        data.totalResults || articles.length,

      fetchedAt:
        new Date().toISOString(),

      articles
    });

  } catch (error) {

    // ---------------------------------------------------------
    // 11. Handle unexpected server errors
    // ---------------------------------------------------------

    console.error(
      "NEWSFORGE News Engine Error:",
      error
    );

    return res.status(500).json({
      status: "error",

      message:
        "Unable to fetch news from the news provider.",

      error:
        error.message || "Unknown server error."
    });
  }
}
