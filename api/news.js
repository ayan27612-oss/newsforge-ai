export default async function handler(req, res) {
  try {
    const apiKey = process.env.NEWS_API_KEY;

    if (!apiKey) {
      return res.status(500).json({
        status: "error",
        message: "NEWS_API_KEY is not configured on the server."
      });
    }

    const {
      country = "in",
      category,
      q,
      pageSize = "20"
    } = req.query;

    const params = new URLSearchParams();

    params.set("country", country);
    params.set("pageSize", String(Math.min(Number(pageSize) || 20, 100)));

    if (category) {
      params.set("category", category);
    }

    if (q) {
      params.set("q", q);
    }

    const response = await fetch(
      `https://newsapi.org/v2/top-headlines?${params.toString()}`,
      {
        headers: {
          "X-Api-Key": apiKey
        }
      }
    );

    const data = await response.json();

    if (!response.ok) {
      return res.status(response.status).json({
        status: "error",
        message: data.message || "NewsAPI request failed.",
        code: data.code || "NEWS_API_ERROR"
      });
    }

    const articles = (data.articles || []).map(article => ({
      source: article.source?.name || "Unknown",
      author: article.author || null,
      title: article.title || "Untitled",
      description: article.description || "",
      url: article.url || null,
      image: article.urlToImage || null,
      publishedAt: article.publishedAt || null,
      content: article.content || null
    }));

    return res.status(200).json({
      status: "success",
      source: "NewsAPI",
      country,
      category: category || "general",
      query: q || null,
      totalResults: data.totalResults || articles.length,
      fetchedAt: new Date().toISOString(),
      articles
    });

  } catch (error) {
    console.error("NEWSFORGE News Engine Error:", error);

    return res.status(500).json({
      status: "error",
      message: "Unable to fetch news.",
      error: error.message
    });
  }
}
