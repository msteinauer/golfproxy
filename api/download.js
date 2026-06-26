// Bulk downloader - fetches courses by ID range and stores US ones in Supabase
// Call: https://golfproxy.vercel.app/api/download?start=1&end=500
// This is much more efficient than searching - IDs are sequential

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getCourse(id) {
  try {
    const res = await fetch(
      `https://api.golfcourseapi.com/v1/courses/${id}`,
      { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
    );
    if (res.status === 404) return null;
    const data = await res.json();
    if (data.error) return { rateLimited: true };
    return data.course || data;
  } catch {
    return null;
  }
}

async function upsertCourses(courses) {
  if (!courses.length) return;
  const rows = courses.map(c => ({
    id: c.id,
    club_name: c.club_name || c.course_name || "",
    course_name: c.course_name || c.club_name || "",
    city: c.location?.city || "",
    state: c.location?.state || "",
    country: c.location?.country || "",
    latitude: c.location?.latitude || null,
    longitude: c.location?.longitude || null,
    number_of_holes: c.number_of_holes || 18,
    tees: JSON.stringify(c.tees || {}),
  }));

  await fetch(`${SUPABASE_URL}/rest/v1/courses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify(rows)
  });
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const start = parseInt(req.query.start) || 1;
  const end = parseInt(req.query.end) || 200;
  const usOnly = req.query.us !== "false"; // default: US only

  const results = { start, end, us_saved: 0, skipped: 0, not_found: 0, rate_limited: false, last_id: start };
  const batch = [];

  for (let id = start; id <= end; id++) {
    results.last_id = id;
    const course = await getCourse(id);

    if (!course) { results.not_found++; continue; }
    if (course.rateLimited) { results.rate_limited = true; break; }

    const country = (course.location?.country || "").toLowerCase();
    const isUS = country.includes("united states");

    if (usOnly && !isUS) { results.skipped++; continue; }

    batch.push(course);
    results.us_saved++;

    // Save in batches of 50
    if (batch.length >= 50) {
      await upsertCourses(batch);
      batch.length = 0;
    }

    // Small delay to avoid hammering the API
    await new Promise(r => setTimeout(r, 100));
  }

  // Save remaining
  if (batch.length) await upsertCourses(batch);

  res.status(200).json(results);
}
