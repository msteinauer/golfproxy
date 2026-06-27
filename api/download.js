// ID-based downloader with slow rate to avoid hitting limits
// Fetches one course per second to stay well under rate limits
// Call: https://golfproxy.vercel.app/api/download?start=1&end=100
// With 1 req/sec and 10 second Vercel timeout = ~8 courses per call
// Run repeatedly to build database

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getCourse(id) {
  try {
    const res = await fetch(
      `https://api.golfcourseapi.com/v1/courses/${id}`,
      { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
    );
    const text = await res.text();
    if (res.status === 404) return { notFound: true };
    let data;
    try { data = JSON.parse(text); } catch { return { notFound: true }; }
    if (data.error && data.error.includes("rate limit")) return { rateLimited: true };
    // API wraps response in "course" object
    const course = data.course || data;
    if (course.id || course.club_name) return course;
    return { notFound: true };
  } catch {
    return { notFound: true };
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
  const end = parseInt(req.query.end) || 50;
  const delayMs = parseInt(req.query.delay) || 300; // default 300ms between requests

  let saved = 0;
  let notFound = 0;
  let rateLimited = false;
  let lastId = start;
  const batch = [];

  for (let id = start; id <= end; id++) {
    lastId = id;
    const result = await getCourse(id);

    if (result.rateLimited) { rateLimited = true; break; }
    if (result.notFound) { notFound++; }
    else {
      batch.push(result);
      saved++;
      if (batch.length >= 20) {
        await upsertCourses(batch);
        batch.length = 0;
      }
    }

    await new Promise(r => setTimeout(r, delayMs));
  }

  if (batch.length) await upsertCourses(batch);

  res.status(200).json({ start, end, last_id: lastId, saved, not_found: notFound, rate_limited: rateLimited });
}
