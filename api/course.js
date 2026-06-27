const cache = new Map();

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { id } = req.query;
  if (!id) { res.status(400).json({ error: "Missing course id" }); return; }

  if (cache.has(id)) {
    res.setHeader("X-Cache", "HIT");
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).json(cache.get(id));
    return;
  }

  try {
    const response = await fetch(
      `https://api.golfcourseapi.com/v1/courses/${id}`,
      { headers: { "Authorization": `Key ${process.env.GOLF_API_KEY}` } }
    );

    // Read as text first to handle non-JSON responses
    const text = await response.text();

    if (response.status === 404) {
      return res.status(200).json({ notFound: true });
    }

    // Try to parse JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      // Non-JSON response — could be HTML error page
      return res.status(200).json({ notFound: true, raw: text.slice(0, 100) });
    }

    if (data.error === "rate limit exceeded") {
      return res.status(200).json({ rateLimited: true });
    }

    cache.set(id, data);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).json(data);
  } catch (e) {
    res.status(200).json({ notFound: true, error: e.message });
  }
}
