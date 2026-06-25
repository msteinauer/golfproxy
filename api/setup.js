// Run once to create the courses table in Supabase
// Visit: https://golfproxy.vercel.app/api/setup to trigger

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "*");

  const SUPABASE_URL = process.env.SUPABASE_URL;
  const SUPABASE_KEY = process.env.SUPABASE_KEY;

  try {
    // Create table via Supabase REST API (using rpc or direct SQL)
    const response = await fetch(`${SUPABASE_URL}/rest/v1/rpc/create_courses_table`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`
      }
    });

    res.status(200).json({ message: "Setup complete - table created" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
