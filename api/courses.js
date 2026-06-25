// Search courses from Supabase database
// GET /api/courses?q=Bellevue&state=WA

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const GOLF_API_KEY = process.env.GOLF_API_KEY;

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  if (req.method === "OPTIONS") { res.status(200).end(); return; }

  const { q, state } = req.query;

  try {
    // Build Supabase query
    let url = `${SUPABASE_URL}/rest/v1/courses?select=id,club_name,city,state,number_of_holes,tees&limit=50&order=club_name.asc`;

    if (state) {
      url += `&state=eq.${encodeURIComponent(state)}`;
    }
    if (q) {
      url += `&club_name=ilike.${encodeURIComponent("%" + q + "%")}`;
    }

    const response = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });

    if (!response.ok) {
      // Supabase table might not exist yet — fall back to Golf API
      const fallback = await fetch(
        `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(q || state || "golf")}`,
        { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
      );
      const data = await fallback.json();
      res.setHeader("Cache-Control", "public, max-age=86400");
      res.status(200).json(data);
      return;
    }

    const courses = await response.json();

    // Format to match existing app expectations
    const formatted = {
      courses: courses.map(c => ({
        id: c.id,
        club_name: c.club_name,
        course_name: c.club_name,
        number_of_holes: c.number_of_holes,
        location: { city: c.city, state: c.state },
        tees: typeof c.tees === "string" ? JSON.parse(c.tees) : (c.tees || {})
      }))
    };

    res.setHeader("Cache-Control", "public, max-age=3600");
    res.status(200).json(formatted);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
