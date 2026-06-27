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
    const data = await response.json();
    cache.set(id, data);
    res.setHeader("Cache-Control", "public, max-age=86400");
    res.status(200).json(data);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
