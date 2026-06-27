// Fetches courses by ID range - the only way to get ALL courses
// US courses have IDs scattered from ~1 to ~30000
// Call: https://golfproxy.vercel.app/api/download?start=1&end=500
// With 10,000 requests/day, process 500 IDs per batch, 20 batches/day = 10,000 IDs/day
// Day 1: 1-10000, Day 2: 10001-20000, Day 3: 20001-30000

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

async function getCourse(id) {
  try {
    const res = await fetch(
      `https://api.golfcourseapi.com/v1/courses/${id}`,
      { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
    );
    if (res.status === 404) return { notFound: true };
    const data = await res.json();
    if (data.error === "rate limit exceeded") return { rateLimited: true };
    // Return course if it has a valid club name
    if (data.id || data.club_name) return data;
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
  const end = parseInt(req.query.end) || 500;

  let usSaved = 0;
  let notFound = 0;
  let rateLimited = false;
  let lastId = start;
  const batch = [];

  for (let id = start; id <= end; id++) {
    lastId = id;
    const result = await getCourse(id);

    if (result.rateLimited) {
      rateLimited = true;
      break;
    }

    if (result.notFound) {
      notFound++;
      continue;
    }

    // Save all courses (US and non-US) — filter in the app
    batch.push(result);
    usSaved++;

    // Upsert in batches of 50
    if (batch.length >= 50) {
      await upsertCourses(batch);
      batch.length = 0;
    }

    await new Promise(r => setTimeout(r, 100));
  }

  if (batch.length) await upsertCourses(batch);

  res.status(200).json({
    start, end, last_id: lastId,
    saved: usSaved, not_found: notFound,
    rate_limited: rateLimited
  });
}
