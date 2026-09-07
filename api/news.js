export default function handler(req, res) {
  res.status(200).json({
    status: "online",
    service: "NEWSFORGE News Engine",
    message: "News API endpoint is ready."
  });
}
