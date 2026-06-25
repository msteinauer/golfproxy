// Bulk downloader - fetches all US courses state by state and stores in Supabase
// Call: https://golfproxy.vercel.app/api/download?state=Washington
// Or:   https://golfproxy.vercel.app/api/download?all=true

const US_STATES = {
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

// City names per state to use as search terms — maximizes course discovery
const STATE_CITIES = {
  "WA": ["Seattle","Spokane","Tacoma","Bellevue","Kirkland","Redmond","Renton","Olympia","Bellingham","Kennewick","Yakima","Everett","Pasco","Auburn","Sammamish","Issaquah","Woodinville","Snoqualmie","Gig Harbor","Puyallup","Lacey","Lynnwood","Marysville","Shoreline","Bothell","Federal Way","Kent","Burien","Des Moines","Maple Valley"],
  "CA": ["Los Angeles","San Francisco","San Diego","Sacramento","San Jose","Fresno","Oakland","Palm Springs","Pebble Beach","Monterey","Napa","Sonoma","Santa Barbara","Pasadena","Irvine","Riverside","Stockton","Modesto","Bakersfield","Santa Rosa"],
  "FL": ["Miami","Orlando","Tampa","Jacksonville","Naples","Sarasota","Fort Lauderdale","Palm Beach","Boca Raton","Clearwater","St Petersburg","Pensacola","Gainesville","Tallahassee","Daytona Beach","Fort Myers","Ponte Vedra"],
  "TX": ["Houston","Dallas","San Antonio","Austin","Fort Worth","El Paso","Arlington","Corpus Christi","Plano","Lubbock","Amarillo","Laredo","Garland","Irving","Frisco","McKinney","Grand Prairie"],
  "NY": ["New York","Buffalo","Rochester","Albany","Syracuse","Yonkers","Southampton","Mamaroneck","Farmingdale","White Plains","Saratoga Springs"],
  "DEFAULT": ["golf club","country club","golf course","golf links","golf resort","public golf","municipal golf","golf center","golf complex","golf and country"]
};

const GOLF_API_KEY = process.env.GOLF_API_KEY;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;

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
  if (!courses.length) return 0;
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

  const res = await fetch(`${SUPABASE_URL}/rest/v1/courses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "resolution=merge-duplicates"
    },
    body: JSON.stringify(rows)
  });
  return rows.length;
}

async function downloadState(stateAbbr, stateName) {
  const seen = new Set();
  let allCourses = [];
  let requestsUsed = 0;
  let rateLimited = false;

  // Use city names for this state if available, otherwise use generic golf terms
  const cities = STATE_CITIES[stateAbbr] || [];
  const genericTerms = STATE_CITIES.DEFAULT;
  const terms = [...cities, ...genericTerms];

  for (const term of terms) {
    if (rateLimited) break;
    const { courses, rateLimited: rl } = await searchCourses(term);
    rateLimited = rl;
    requestsUsed++;

    const filtered = courses.filter(c => {
      const cs = (c.location?.state || "").toUpperCase().trim();
      return cs === stateAbbr && !seen.has(c.id);
    });
    filtered.forEach(c => { seen.add(c.id); allCourses.push(c); });

    await new Promise(r => setTimeout(r, 150));
  }

  const saved = await upsertCourses(allCourses);
  return { state: stateAbbr, found: allCourses.length, saved, requests_used: requestsUsed, rate_limited: rateLimited };
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const { state, all } = req.query;

  try {
    if (all === "true") {
      const results = [];
      for (const [stateName, stateAbbr] of Object.entries(US_STATES)) {
        const result = await downloadState(stateAbbr, stateName);
        results.push(result);
        if (result.rate_limited) break;
        await new Promise(r => setTimeout(r, 300));
      }
      const total = results.reduce((sum, r) => sum + r.found, 0);
      res.status(200).json({ results, total_courses: total });
    } else if (state) {
      const stateAbbr = US_STATES[state] || state.toUpperCase();
      const stateName = Object.keys(US_STATES).find(k => US_STATES[k] === stateAbbr) || state;
      const result = await downloadState(stateAbbr, stateName);
      res.status(200).json(result);
    } else {
      res.status(400).json({ error: "Pass ?state=Washington or ?all=true" });
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
