// Downloader - searches "golf [state]" and "club [state]" for all 50 US states
// Only 100 API requests total for full coverage!
// Call: https://golfproxy.vercel.app/api/download?state=Washington
// Or:   https://golfproxy.vercel.app/api/download?all=true

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

const US_STATES = [
  "Alabama","Alaska","Arizona","Arkansas","California","Colorado","Connecticut",
  "Delaware","Florida","Georgia","Hawaii","Idaho","Illinois","Indiana","Iowa",
  "Kansas","Kentucky","Louisiana","Maine","Maryland","Massachusetts","Michigan",
  "Minnesota","Mississippi","Missouri","Montana","Nebraska","Nevada","New Hampshire",
  "New Jersey","New Mexico","New York","North Carolina","North Dakota","Ohio",
  "Oklahoma","Oregon","Pennsylvania","Rhode Island","South Carolina","South Dakota",
  "Tennessee","Texas","Utah","Vermont","Virginia","Washington","West Virginia",
  "Wisconsin","Wyoming"
];

const STATE_ABBREVS = {
  "Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA",
  "Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA",
  "Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS",
  "Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA",
  "Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT",
  "Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM",
  "New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK",
  "Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC",
  "South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT",
  "Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY"
};

async function searchCourses(query) {
  try {
    const res = await fetch(
      `https://api.golfcourseapi.com/v1/search?search_query=${encodeURIComponent(query)}`,
      { headers: { "Authorization": `Key ${GOLF_API_KEY}` } }
    );
    const data = await res.json();
    if (data.error) return { courses: [], rateLimited: true };
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

async function downloadState(stateName) {
  const stateAbbr = STATE_ABBREVS[stateName];
  const seen = new Set();
  const stateCourses = [];
  let requests = 0;
  let rateLimited = false;

  // Just two searches per state: "golf [state]" and "club [state]"
  for (const term of ["golf", "club"]) {
    if (rateLimited) break;
    const query = `${term} ${stateName}`;
    const { courses, rateLimited: rl } = await searchCourses(query);
    requests++;
    rateLimited = rl;

    // Save ALL US courses from results, not just this state
    courses.forEach(c => {
      const country = (c.location?.country || "").toLowerCase();
      const isUS = country.includes("united states") || country.includes("usa") || country === "";
      if (isUS && !seen.has(c.id)) {
        seen.add(c.id);
        stateCourses.push(c);
      }
    });

    await new Promise(r => setTimeout(r, 150));
  }

  await upsertCourses(stateCourses);
  return { state: stateName, found: stateCourses.length, requests, rateLimited };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  const { state, all } = req.query;

  try {
    if (state) {
      const result = await downloadState(state);
      res.status(200).json(result);
    } else if (all === "true") {
      const results = [];
      let totalFound = 0;
      let totalRequests = 0;

      for (const stateName of US_STATES) {
        const result = await downloadState(stateName);
        results.push(result);
        totalFound += result.found;
        totalRequests += result.requests;
        if (result.rateLimited) break;
        await new Promise(r => setTimeout(r, 300));
      }

      res.status(200).json({ results, total_found: totalFound, total_requests: totalRequests });
    } else {
      res.status(400).json({ error: "Pass ?state=Washington or ?all=true" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
