// Scheduled cron job - runs nightly to download more courses
// Vercel will call this automatically based on vercel.json schedule

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const CRON_SECRET = process.env.CRON_SECRET || "golflog";

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

async function getNextId() {
  // Get the highest ID in our database to know where to resume
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/progress?select=next_id&key=eq.download&limit=1`,
      { headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` } }
    );
    const data = await res.json();
    return data[0]?.next_id || 1;
  } catch { return 1; }
}

async function saveNextId(id) {
  await fetch(`${SUPABASE_URL}/rest/v1/progress`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify({ key: "download", next_id: id })
  });
}

export default async function handler(req, res) {
  // Verify this is called by Vercel cron or with secret
  const auth = req.headers.authorization;
  if (auth !== `Bearer ${CRON_SECRET}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const startId = await getNextId();
  const maxRequests = 9000; // Stay under 10,000/day limit
  const delayMs = 300;

  let saved = 0;
  let notFound = 0;
  let rateLimited = false;
  let lastId = startId;
  const batch = [];

  for (let id = startId; id <= 30000 && saved + notFound < maxRequests; id++) {
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
  await saveNextId(lastId + 1);

  res.status(200).json({
    started_at: startId,
    last_id: lastId,
    saved,
    not_found: notFound,
    rate_limited: rateLimited,
    next_run_starts_at: lastId + 1
  });
}
