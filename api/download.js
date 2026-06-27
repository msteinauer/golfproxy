// Downloads all US courses using search API with alphabetical queries
// Searches "a", "b", "c"... plus common golf words to maximize coverage
// Search API has separate (higher) rate limit than courses/{id} endpoint

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

// Alphabetical single letters + common golf name words
const SEARCH_TERMS = [
  "a","b","c","d","e","f","g","h","i","j","k","l","m",
  "n","o","p","q","r","s","t","u","v","w","x","y","z",
  "golf","club","country","links","course","creek","ridge",
  "lake","hill","pines","oak","cedar","pine","eagle","birch",
  "meadow","valley","river","forest","ranch","resort","national",
  "municipal","public","royal","bay","sand","rock","stone",
  "green","fairway","par","ace","iron","wood","wedge","driver"
];

async function searchCourses(query) {
  try {
    const res = await fetch(
      `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(query)}`,
      { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
    );
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { return { courses: [], rateLimited: false }; }
    if (data.error && data.error.includes("rate limit")) return { courses: [], rateLimited: true };
    return { courses: data.courses || [], rateLimited: false };
  } catch {
    return { courses: [], rateLimited: false };
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

  // start/end refer to index into SEARCH_TERMS array
  const startIdx = parseInt(req.query.start) || 0;
  const endIdx = parseInt(req.query.end) || SEARCH_TERMS.length - 1;

  const seen = new Set();
  let totalSaved = 0;
  let totalRequests = 0;
  let rateLimited = false;
  let lastTerm = "";
  let lastIdx = startIdx;
  const results = [];

  for (let i = startIdx; i <= endIdx && i < SEARCH_TERMS.length; i++) {
    if (rateLimited) break;
    const term = SEARCH_TERMS[i];
    lastTerm = term;
    lastIdx = i;

    const { courses, rateLimited: rl } = await searchCourses(term);
    totalRequests++;
    rateLimited = rl;

    // Save ALL courses (US and non-US) — app filters by state
    const newCourses = courses.filter(c => !seen.has(c.id));
    newCourses.forEach(c => seen.add(c.id));

    await upsertCourses(newCourses);
    totalSaved += newCourses.length;
    results.push({ term, found: newCourses.length });

    await new Promise(r => setTimeout(r, 50));
  }

  res.status(200).json({
    start_idx: startIdx,
    end_idx: endIdx,
    last_idx: lastIdx,
    last_term: lastTerm,
    total_saved: totalSaved,
    total_requests: totalRequests,
    rate_limited: rateLimited,
    results
  });
}
