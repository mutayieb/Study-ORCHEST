// MUTAYIEB - Optional Vercel serverless proxy
// Deploy this folder to Vercel, set OPENROUTER_API_KEY as an environment variable,
// then set USE_PROXY = true in index.html to route agent calls through this endpoint
// (keeps your key on the server instead of the browser).
export default function handler(req, res) {
  if (req.method === "OPTIONS") {
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization");
    return res.status(204).end();
  }
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Method not allowed" });
  }

  const key = process.env.OPENROUTER_API_KEY || "";
  if (!key) {
    return res.status(500).json({ error: "OPENROUTER_API_KEY environment variable is not set" });
  }

  let body;
  try {
    body = typeof req.body === "string" ? JSON.parse(req.body) : (req.body || {});
  } catch (e) {
    return res.status(400).json({ error: "Invalid JSON body" });
  }

  const userPrompt = body.userPrompt || "";
  const mask = body.mask || {};
  const globalPrompt = mask.globalPrompt || "";
  const agents = Array.isArray(mask.agents) ? mask.agents : [];

  if (!userPrompt) return res.status(400).json({ error: "userPrompt is required" });
  if (!agents.length) return res.status(400).json({ error: "Mask has no agents configured" });

  const tasks = agents.map(async (agent) => {
    const agentTitle = agent.title || "Agent";
    const model = agent.model || "meta-llama/llama-3.3-70b-instruct:free";
    const system = globalPrompt + "\n\nYour Specific Role: " + (agent.instructions || "");
    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mutayieb.vercel.app",
          "X-Title": "MUTAYIEB"
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: system },
            { role: "user", content: userPrompt }
          ]
        })
      });
      const data = await resp.json();
      if (!resp.ok) {
        const errMsg = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + resp.status);
        return { agentTitle: agentTitle, model: model, output: "", error: errMsg };
      }
      const choice = data.choices && data.choices[0] ? data.choices[0] : null;
      const content = choice && choice.message ? choice.message.content : "";
      return { agentTitle: agentTitle, model: model, output: content || "", error: null };
    } catch (err) {
      return { agentTitle: agentTitle, model: model, output: "", error: err.message };
    }
  });

  return Promise.all(tasks).then((results) => {
    res.setHeader("Access-Control-Allow-Origin", "*");
    return res.status(200).json({ results: results });
  });
}
