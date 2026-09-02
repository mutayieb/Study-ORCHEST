// ============================================================
// MUTAYIEB — UNIVERSAL SINGLE-FILE ENGINE
// Works on: Vercel, Cloudflare Workers, Node.js, Deno Deploy
// No framework, no build step, no dependencies.
// ============================================================

const HARDCODED_API_KEY = "PASTE_YOUR_OPENROUTER_API_KEY_HERE";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization"
};

// ------------------------------------------------------------
// CORE ROUTER (returns a standard web Response)
// ------------------------------------------------------------
async function route(request) {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  try {
    if (url.pathname === "/" && request.method === "GET") {
      return new Response(HTML_PAGE, {
        headers: { "Content-Type": "text/html;charset=UTF-8", ...CORS_HEADERS }
      });
    }

    if (url.pathname === "/api/models" && request.method === "GET") {
      return await handleModels(url);
    }

    if (url.pathname === "/api/orchestrate" && request.method === "POST") {
      return await handleOrchestrate(request);
    }

    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Server exception", detail: String(err && err.message || err) }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

async function handleModels(url) {
  let key = url.searchParams.get("key");
  if (!key || key.trim() === "") key = HARDCODED_API_KEY;

  try {
    const resp = await fetch("https://openrouter.ai/api/v1/models", {
      method: "GET",
      headers: {
        "Authorization": "Bearer " + key,
        "HTTP-Referer": "https://mutayieb.app",
        "X-Title": "MUTAYIEB"
      }
    });

    if (!resp.ok) {
      const errText = await resp.text();
      return Response(JSON.stringify({ error: "Failed to fetch models", status: resp.status, detail: errText }), {
        status: resp.status,
        headers: { "Content-Type": "application/json", ...CORS_HEADERS }
      });
    }

    const data = await resp.json();
    const list = Array.isArray(data.data) ? data.data : [];
    const ids = list.map(m => m.id).filter(Boolean).sort();

    return new Response(JSON.stringify(ids), {
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: "Exception fetching models", detail: err.message }), {
      status: 500,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
}

async function handleOrchestrate(request) {
  let body;
  try {
    body = await request.json();
  } catch (err) {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const userPrompt = body.userPrompt || "";
  const mask = body.mask || {};
  const globalPrompt = mask.globalPrompt || "";
  const agents = Array.isArray(mask.agents) ? mask.agents : [];

  let key = mask.apiKey;
  if (!key || key.trim() === "") key = HARDCODED_API_KEY;

  if (!userPrompt) {
    return new Response(JSON.stringify({ error: "userPrompt is required" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }
  if (agents.length === 0) {
    return new Response(JSON.stringify({ error: "Mask has no agents configured" }), {
      status: 400, headers: { "Content-Type": "application/json", ...CORS_HEADERS }
    });
  }

  const agentPromises = agents.map(async (agent, idx) => {
    const agentTitle = agent.title || ("Agent " + (idx + 1));
    const model = agent.model || "meta-llama/llama-3.3-70b-instruct:free";
    const systemMessage = globalPrompt + "\n\nYour Specific Role: " + (agent.instructions || "");

    try {
      const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: {
          "Authorization": "Bearer " + key,
          "Content-Type": "application/json",
          "HTTP-Referer": "https://mutayieb.app",
          "X-Title": "MUTAYIEB"
        },
        body: JSON.stringify({
          model: model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: userPrompt }
          ]
        })
      });

      const data = await resp.json();

      if (!resp.ok) {
        const errMsg = (data && data.error && data.error.message) ? data.error.message : ("HTTP " + resp.status);
        return { agentTitle, model, output: "", error: errMsg };
      }

      const choice = data.choices && data.choices[0] ? data.choices[0] : null;
      const content = choice && choice.message ? choice.message.content : "";
 return { agentTitle, model, output: content || "", error: null };
    } catch (err) {
      return { agentTitle, model, output: "", error: err.message };
    }
  });

  const results = await Promise.all(agentPromises);

  return new Response(JSON.stringify({ results }), {
    headers: { "Content-Type": "application/json", ...CORS_HEADERS }
  });
}

// ------------------------------------------------------------
// UNIVERSAL ENTRY POINT — auto-detects the hosting platform
// ------------------------------------------------------------
async function universalHandler(a, b, c) {
  // Cloudflare Workers / Deno Deploy: called as (Request, env, ctx)
  if (a && typeof a === "object" && typeof a.url === "string" && typeof a.headers === "object" && typeof a.headers.get === "function") {
    return route(a);
  }
  // Node.js / Vercel Serverless: called as (httpReq, httpRes)
  if (a && b && typeof b.setHeader === "function" && typeof b.end === "function") {
    return nodeHandler(a, b);
  }
  return new Response("MUTAYIEB engine: unsupported runtime", { status: 500 });
}
universalHandler.fetch = (request, env, ctx) => universalHandler(request, env, ctx);
export default universalHandler;

// Optional legacy Cloudflare Service-Worker support (non-ESM runtimes)
if (typeof addEventListener === "function" && typeof Request === "function") {
  try {
    addEventListener("fetch", (event) => event.respondWith(route(event.request)));
  } catch (e) { /* ignore if not a worker env */ }
}

// Node.js / Vercel adapter: converts http.IncomingMessage -> Request, Response -> res
async function nodeHandler(req, res) {
  try {
    const host = req.headers.host || "localhost";
    const proto = req.headers["x-forwarded-proto"] || "http";
    const url = new URL(req.url, proto + "://" + host);

    let bodyStr;
    if (req.method !== "GET" && req.method !== "HEAD") {
      bodyStr = await new Promise((resolve, reject) => {
        let chunks = [];
        req.on("data", (ch) => chunks.push(ch));
        req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
        req.on("error", reject);
      });
    }

    const cleanHeaders = {};
    for (const [k, v] of Object.entries(req.headers)) {
      const lk = k.toLowerCase();
      if (lk !== "host" && lk !== "content-length" && lk !== "connection") cleanHeaders[k] = v;
    }

    const request = new Request(url.toString(), {
      method: req.method,
      headers: cleanHeaders,
      body: bodyStr
    });

    const response = await route(request);
    res.statusCode = response.status;
    response.headers.forEach((v, k) => res.setHeader(k, v));
    const buf = Buffer.from(await response.arrayBuffer());
    res.end(buf);
  } catch (err) {
    res.statusCode = 500;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify({ error: "Node handler exception", detail: String(err && err.message || err) }));
  }
}

// Allow CJS-style require() too (some Node hosts)
if (typeof module !== "undefined" && module.exports) {
  module.exports = universalHandler;
 .exports.default = universalHandler;
  module.exports.fetch = universalHandler.fetch;
}

// ============================================================
// EMBEDDED SINGLE PAGE APPLICATION
// ============================================================
const HTML_PAGE = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>MUTAYIEB &mdash; Multi-Agent Orchestration Engine</title>
<script src="https://cdn.jsdelivr.net/npm/marked/marked.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/mermaid/dist/mermaid.min.js"></script>
<script src="https://cdnjs.cloudflare.com/ajax/libs/html2pdf.js/0.10.1/html2pdf.bundle.min.js"></script>
<style>
  :root{
    --bg:#0f172a; --panel:#1e293b; --panel-2:#172033;
    --accent:#3b82f6; --accent-dark:#2563eb; --success:#10b981;
    --danger:#ef4444; --text:#e2e8f0; --muted:#94a3b8; --border:#334155;
  }
  *{box-sizing:border-box;}
  html,body{margin:0;padding:0;height:100%;width:100%;}
  body{background:var(--bg);color:var(--text);font-family:'Segoe UI',Roboto,Helvetica,Arial,sans-serif;overflow:hidden;}
  #app{display:flex;flex-direction:column;height:100vh;width:100vw;}
  header{display:flex;align-items:center;justify-content:space-between;padding:14px 22px;background:var(--panel);border-bottom:1px solid var(--border);flex-shrink:0;z-index:20;}
  .header-left{display:flex;align-items:center;gap:14px;}
  #drawerToggle{:transparent;border:1px solid var(--border);color:var(--text);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:16px;}
  #drawerToggle:hover{border-color:var(--accent);}
  .brand{font-size:22px;font-weight:800;letter-spacing:1px;color:#fff;}
  .header-right{display:flex;align-items:center;gap:10px;}
  .status-badge{background:rgba(16,185,129,0.12);color:var(--success);border:1px solid var(--success);padding:6px 14px;border-radius:20px;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;}
  .status-dot{width:8px;height:8px;border-radius:50%;background:var(--success);box-shadow:0 0 8px var(--success);}
  #globalKeyBtn{background:transparent;border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:6px 14px;font-size:12px;font-weight:700;cursor:pointer;}
  #globalKeyBtn.saved{color:var(--success);border-color:var(--success);}
  #globalKeyBtn:hover{border-color:var(--accent);color:var(--accent);}
  .main-layout{display:flex;flex:1;overflow:hidden;}
  #drawer{width:360px;min-width:360px;background:var(--panel);border-right:1px solid var(--border);display:flex;flex-direction:column;overflow-y:auto;transition:margin-left .25s ease;}
  #drawer.collapsed{margin-left:-360px;}
  .drawer-section{padding:16px;border-bottom:1px solid var(--border);}
  .drawer-title{font-size:13px;text-transform:uppercase;letter-spacing:1px;color:var(--muted);margin-bottom:12px;font-weight700;}
  .mask-row{display:flex;align-items:center;justify-content:space-between;background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:8px;cursor:pointer;transition:border-color .15s;}
  .mask-row:hover{border-color:var(--accent);}
  .mask-row.editing{border-color:var(--accent);background:rgba(59,130,246,0.08);}
  .mask-row-title{font-size:14px;font-weight:600;color:var(--text);}
  .mask-row-sub{font-size:11px;color:var(--muted);margin-top:2px;}
  .mask-row-actions button{background:transparent;border:none;color:var(--muted);cursor:pointer;font-size:15px;padding:4px 6px;}
  .mask-row-actions button:hover{color:var(--danger);}
  .btn{background:var(--accent);color:#fff;border:none;border-radius:8px;padding:10px 14px;font-size:13px;font-weight:700;cursor:pointer;width:100%;transition:background .15s;}
  .btn:hover{background:var(--accent-dark);}
  .btn:disabled{background:#475569;cursor:not-allowed;opacity:0.6;}
  .btn-success{background:var(--success);}
  .btn-success:hover{background:#0d9c6f;}
  .btn-outline{background:transparent;border:1px solid var(--border);color:var(--text);}
  .btn-outline:hover{border-color:var(--accent);color:var(--accent);}
  label{display:block;font-size:12px;color:var(--muted);-bottom:5px;font-weight:600;margin-top:12px;}
  input[type=text],input[type=password],textarea,select{width:100%;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:9px 10px;font-size:13px;font-family:inherit;}
  input:focus,textarea:focus,select:focus{outline:none;border-color:var(--accent);}
  textarea{resize:vertical;min-height:60px;}
  .agent-card{background:var(--panel-2);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:12px;}
  .agent-card-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px;}
  .agent-card-header span{font-size:12px;font-weight:700;color:var(--accent);}
  .remove-agent-btn{background:transparent;border:none;color:var(--danger);cursor:pointer;font-size:13px  .divider{height:1px;background:var(--border);margin:14 0;}
  main#mainArea{flex:1;display:flex;flex-direction:column;overflow:hidden;background:var(--bg);}
  #maskPillsWrap{display:flex;gap:8px;padding:12px 20px;border-bottom:1 solid var(--border);overflow-x:auto;flex-shrink:0;background:var(--panel);}
  .mask-pill{background:var(--panel-2);border:1px solid var(--border);color:var(--muted);border-radius:20px;padding:8px 16px;font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;}
  .mask-pill.active{background:var(--accent);border-color:var(--accent);color:#fff;}
  .mask-pill:hover{border-color:var(--accent);}
  #transcript{flex:1;overflow-y:auto;padding:20px 24px;display:flex;flex-direction:column;gap:18px;}
  .empty-state{color:var(--muted);text-align:center;margin-top:60px;font-size:14px;}
  .user-bubble{align-self:flex-end;background:var(--accent);color:#fff;padding:12px 16px;border-radius:14px 14px 2px 14px;max-width:70%;font-size:14px;line-height:1.5;}
  .response-block{width:100%;}
  .response-toolbar{display:flex;justify-content:flex-end;margin-bottom:12px;}
  .pdf-btn{background:var(--success);color:#fff;border:none;border-radius:8px;padding:10px 18px;font-size:13px;font-weight:700;cursor:pointer;display:flex;align-items:center;gap:8px;}
  .pdf-btn:hover{background:#0d9c6f;}
  .agent-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:16px;}
  .agent-output-card{background:var(--panel);border:1px solid var(--border);border-radius:12px;padding:16px;overflow:auto;max-height:520px;}
  .agent-output-title{font-size:13px;font-weight:800;color:var(--accent);margin-bottom:2px;}
  .agent-output-model{font-size:11px;color:var(--muted);margin-bottom:10px;}
  .agent-output-body{font-size:13px;line-height:1.6;color:var(--text);}
  .agent-output-body pre{background:#0b1220;padding:10px;border-radius:8px;overflow-x:auto;}
  .agent-output-body code{background:#0b1220;padding:2px 5px;border-radius:4px;font-size:12px;}
  .agent-output-body table{border-collapse:collapse;width:%;}
  .agent-output-body th,.agent-output-body td{border:1px solid var(--border);padding:6px 8px;font-size:12px;}
  .agent-error{color:var(--danger);font-size:12px;font-weight:600;}
  .loading-status{align-self:center;color:var(--accent);font-size:13px;font-weight:700;padding:10px 18px;background:var(--panel);border:1px solid var(--border);border-radius:20px;}
  #promptBar{display:flex;gap:10px;padding:16px 20px;border-top:1px solid var(--border);background:(--panel);flex-shrink:0;}
  #promptInput{flex:1;min-height:48px;max-height:140px;}
  #sendBtn{width:auto;padding:0 24px;flex-shrink:0;}
  ::-webkit-scrollbar{width:8px;height:8px;}
  ::-webkit-scrollbar-thumb{background:var(--border);border-radius:4px;}
  ::-webkit-scrollbar-track{background:transparent;}
  .field-hint{font-size:11px;color:var(--muted);margin-top:4px;}
  .agents-count{font-size:11px;color:var(--muted);margin-top:6px;text-align:center;}
</style>
</head>
<body>
<div id="app">
  <header>
    <div class="header-left">
      <button id="drawerToggle" title="Toggle Mask Drawer">&#9776;</button>
      <div class="brand">MUTAYIEB</div>
    </div>
    <div class="header-right">
      <button id="globalKeyBtn">&#128273; Set API Key</button>
      <div class="status-badge"><span class="status-dot"></span>Universal Edge Engine</div>
    </div>
  </header>

  <div class="main">
    <aside id="drawer">
      <div class="drawer-section">
        <div class="drawer-title">Mask Management</div>
        <div id="maskListContainer"></div>
        <button class="btn" id="newMaskBtn" style="margin-top:8px;">+ Create New Mask</button>
      </div>

      <div class="drawer-section" id="editorSection" style="display:none;">
        <div class="drawer-title">Edit Mask</div>
        <label>Mask Title</label>
        <input type="text" id="maskTitleInput" placeholder="e.g. MUTAYIEB Master Engine">

        <label>Primary Objective / Global System Instruction</label>
        <textarea id="maskGlobalPromptInput" placeholder="Describe the overall objective for all agents..."></textarea>

        <label>Custom API Key (Optional Override)</label>
        <input type="password" id="maskApiKeyInput" placeholder="Leave blank to use your saved global key">
        <div class="field-hint">If left blank, your globally saved key (set once via the top-right button) is used automatically.</div>

        <button class="btn btn-outline" id="syncModelsBtn" style="margin-top:14px;">&#128260; Sync Models from OpenRouter</button>

        <div class="divider"></div>
        <div class="drawer-title">Agents</div>
        <div id="agentsFormContainer"></div>
        <div class="agents-count" id="agentsCountLabel"></div>
        <button class="btn" id="addAgentBtn" style="margin-top:10px;">+ Add Agent</button>

        <div class="divider"></div>
        <button class="btn btn-success" id="saveMaskBtn">Save Mask</button>
      </div>
    </aside>

    <main id="mainArea">
      <div id="maskPillsWrap"></div>
      <div id="transcript">
        <div class="empty-state" id="emptyState">Select or create a Mask, then send a prompt to begin orchestration across all agents in parallel.</div>
      </div>
      <div id="promptBar">
        <textarea id="promptInput" placeholder="Enter your prompt for the active Mask's agent squad..."></textarea>
        <button class="btn" id="sendBtn">Send Prompt</button>
      </div>
    </main>
  </div>
</div>

<script>
(function () {
  var STORAGE_KEY = 'mutayieb_masks';
  var ACTIVE_KEY = 'mutayieb_active_mask';
  var GLOBAL_KEY = 'mutayieb_global_key';
  var MAX_MASKS = 10;
  var MAX_AGENTS = 10;

  var DEFAULT_MODELS = [
    'meta-llama/llama-3.3-70b-instruct:free',
    'qwen/qwen-2.5-coder-32b-instruct:free',
    'deepseek/deepseek-r1:free',
    'google/gemini-2.0-flash-lite-001'
  ];

  var state = {
    masks: [],
    activeMaskId: null,
    editingMaskId: null,
    availableModels: DEFAULT_MODELS.slice()
  };

  function uid() {
    return 'id_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 9);
  }

  // ---------- GLOBAL API KEY (entered ONCE) ----------
  function getGlobalKey() { return localStorage.getItem(GLOBAL_KEY) || ''; }
  function getKeyFor(mask) {
    if (mask && mask.apiKey && mask.apiKey.trim() !== '') return mask.apiKey.trim();
    return getGlobalKey();
  }
  function updateKeyBtn() {
    var btn = document.getElementById('globalKeyBtn');
    if (getGlobalKey()) {
      btn.classList.add('saved');
      btn.innerHTML = '&#128273; Key Saved';
    } {
      btn.classList.remove('saved');
      btn.innerHTML = '&#128273; Set API Key';
    }
  }
  function askGlobalKey() {
    var current = getGlobalKey();
    var k = prompt('Paste your OpenRouter API key (saved in your browser, asked only once):', current);
    if (k === null) return;
    k = k.trim();
    if (k === '') {
      localStorage.removeItem(GLOBAL_KEY);
      alert('Global key removed. The server default key will be used.');
    } else {
      localStorage.setItem(GLOBAL_KEY, k);
      alert('API key saved. You will not be asked again.');
    }
    updateKeyBtn();
  }

  function defaultMask() {
    return {
      id: uid(),
      title: 'MUTAYIEB Master Engine',
      globalPrompt: 'Perform an exhaustive, master-level structural and conceptual breakdown of the provided topic.',
      apiKey: '',
      agents: [
        { id: uid(), title: 'Logic Expert', instructions: 'You are Agent 1: Deep-Dive Logic & Concept Explanation Expert.', model: 'meta-llama/llama-3.3-70b-instruct:free'
        { id: uid(), title: 'Logic Expert', instructions: 'You are Agent 1: Deep-Dive Logic & Concept Explanation Expert.', model: 'meta-llama/llama-3.3-70b-instruct:free' },
        { id: uid(), title: 'Mermaid Specialist', instructions: 'You are Agent 2: Mermaid Diagram & Mindmap Specialist. Always output valid ```mermaid code blocks for diagrams.', model: 'qwen/qwen-2.5-coder-32b-instruct:free' },
        { id: uid(), title: 'Architecture Specialist', instructions: 'You are Agent 3: System & Structural Architecture Specialist.', model: 'qwen/qwen-2.5-coder-32b-instruct:free' },
        { id: uid(), title: 'Formula & Syntax Master', instructions: 'You are Agent 4: Formula, Syntax & Cheat-Sheet Master.', model: 'deepseek/deepseek-r1:free' },
        { id: uid(), title: 'Exam & Practice Simulator', instructions: 'You are Agent 5: Practice Questions, Edge Cases & Exam Simulator.', model: 'google/gemini-2.0-flash-lite-001' }
      ]
    };
  }

  function loadMasks() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) {
        state.masks = [defaultMask()];
        state.activeMaskId = state.masks[0].id;
        saveMasks();
        return;
      }
      state.masks = JSON.parse(raw) || [];
      if (state.masks.length === 0) {
        state.masks = [defaultMask()];
        state.activeMaskId = state.masks[0].id;
        saveMasks();
      }
      var savedActive = localStorage.getItem(ACTIVE_KEY);
      if (savedActive && state.masks.some(m => m.id === savedActive)) {
        state.activeMaskId = savedActive;
      } else {
        state.activeMaskId = state.masks[0].id;
      }
    } catch (e) {
      state.masks = [defaultMask()];
      state.activeMaskId = state.masks[0].id;
    }
  }

  function saveMasks() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.masks));
    localStorage.setItem(ACTIVE_KEY, state.activeMaskId || '');
  }

  function getActiveMask() {
    return state.masks.find(m => m.id === state.activeMaskId) || null;
  }

  // ---------- RENDERING: MASK LIST ----------
  function renderMaskList() {
    var c = document.getElementById('maskListContainer');
    c.innerHTML = '';
    state.masks.forEach(function (mask) {
      var row = document.createElement('div');
      row.className = 'mask-row' + (mask.id === state.editingMaskId ? ' editing' : '');
      row.innerHTML =
        '<div><div class="mask-row-title">' + escapeHtml(mask.title) + '</div>' +
        '<div class="mask-row-sub">' + mask.agents.length + ' agent(s)</div>>' +
        '<div class="mask-row-actions"><button title="Delete">&#128465;</button></div>';
      row.addEventListener('click', function () {
        state.activeMaskId = mask.id;
        saveMasks();
        renderPills();
      });
      row.querySelector('button').addEventListener('click', function (e) {
        e.stopPropagation();
        if (!confirm('Delete mask "' + mask.title + '"?')) return;
        state.masks = state.masks.filter(m => m.id !== mask.id);
        if (state.activeMaskId === mask) state.activeMaskId = state.masks.length ? state.masks[0].id : null;
        if (state.editingMaskId === mask.id) state.editingMaskId = null;
        saveMasks();
        renderMaskList();
        renderPills();
        renderEditor();
      });
      c.appendChild(row);
    });
  }

  // ---------- RENDERING: PILLS ----------
  function renderPills() {
    var wrap = document.getElementById('maskPillsWrap');
    wrap.innerHTML = '';
    state.masks.forEach(function (mask) {
      var pill = document.createElement('div');
      pill.className = 'mask-pill' + (mask.id === state.activeMaskId ? ' active' : '');
      pill.textContent = mask.title;
      pill('click', function () {
        state.activeMaskId = mask.id;
        saveMasks();
        renderPills();
      });
      wrap.appendChild(pill);
    });
  }

  // ---------- RENDERING: EDITOR ----------
  function renderEditor() {
    var sec = document.getElementById('editorSection');
    var mask = state.masks.find(m => m.id === state.editingMaskId);
    if (!mask) {
      sec.style.display = 'none';
      renderMaskList();
      return;
    }
    sec.style.display = 'block';
    document.getElementById('maskTitleInput').value = mask.title;
    document.getElementById('maskGlobalPromptInput').value = mask.globalPrompt;
    document.getElementById('maskApiKeyInput').value = mask.apiKey || '';
    renderAgentsForm();
    renderMaskList();
  }

  function renderAgentsForm() {
    var mask = state.masks.find(m => m.id === state.editingMaskId);
    var c = document.getElementById('agentsFormContainer');
    c.innerHTML = '';
    mask.agents.forEach(function (agent, idx) {
      var card = document.createElement('div');
      card.className = 'agent-card';
      var optionsHtml = state.availableModels.map(function (m) {
        return '<option value="' + escapeHtml(m) + '"' + (m === agent.model ? ' selected' : '') + '>' + escapeHtml(m) + '</option>';
      }).join('');
      card.innerHTML =
        '<div class="agent-card-header"><span>AGENT ' + (idx + 1) + '</span>' +
        '<button class="remove-agent-btn" title="Remove agent">&#10060;</button></div>' +
        '<label>Agent Title</label><input type="text" class="a-title" value="' + escapeHtml(agent.title) + '">' +
        '<label>Specific Instructions (System Prompt)</label><textarea class="a-instr">' + escapeHtml(agent.instructions) + '</textarea>' +
        '<label>Model</label><select class="a-model">' + optionsHtml + '</select>';
      card.querySelector('.a-title').addEventListener('input', function (e) { agent.title = e.target.value; });
      card.querySelector('.a-instr').addEventListener('input', function (e) { agent.instructions = e.target.value; });
      card.querySelector('.a-model').addEventListener('change', function (e) { agent.model = e.target.value; });
      card.querySelector('.remove-agent-btn').addEventListener('click', function () {
        mask.agents = mask.agents.filter(a => a.id !== agent.id);
        renderAgentsForm();
      });
      c.appendChild(card);
    });
    var countLabel = document.getElementById('agentsCountLabel');
    countLabel.textContent = mask.agents.length + ' / ' + MAX_AGENTS + ' agents';
    document.getElementById('addAgentBtn').disabled = mask.agents.length >= MAX_AGENTS;
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- EDITOR EVENTS ----------
  document.getElementById('newMaskBtn').addEventListener('click', function () {
    if (state.masks.length >= MAX_MASKS) {
      alert('Maximum of ' + MAX_MASKS + ' masks reached. Delete one to create a new mask.');
      return;
    }
    var m = defaultMask();
    m.id = uid();
    m.title = 'New Mask ' + (state.masks.length + 1);
    m.agents = [{ id: uid(), title: 'Agent 1', instructions: '', model: state.availableModels[0] }];
    state.masks.push(m);
    state.editingMaskId = m.id;
    state.activeMaskId = m.id;
    saveMasks();
    renderPills();
    renderEditor();
  });

  document.getElementById('saveMaskBtn').addEventListener('click', function () {
    var mask = state.masks.find(m => m.id === state.editingMaskId);
    if (!mask) return;
    mask.title = document.getElementById('maskTitleInput').value.trim() || 'Untitled Mask';
    mask.globalPrompt = document.getElementById('maskGlobalPromptInput').value;
    mask.apiKey = document.getElementById('maskApiKeyInput').value.trim();
    if (mask.agents.length === 0) { alert('A mask must have at least 1 agent.'); return; }
    state.editingMaskId = null;
    saveMasks();
    renderPills();
    renderEditor();
    alert('Mask saved.');
  });

  document.getElementById('addAgentBtn').addEventListener('click', function () {
    var mask = state.masks.find(m => m.id === state.editingMaskId);
    if (!mask || mask.agents.length >= MAX_AGENTS) return;
    mask.agents.push({ id: uid(), title: 'Agent ' + (mask.agents.length + 1), instructions: '', model: state.availableModels[0] });
    renderAgentsForm();
  });

  document.getElementById('syncModelsBtn').addEventListener('click', async function () {
    var btn = this;
    btn.disabled = true;
    var original = btn.innerHTML;
    btn.innerHTML = 'Syncing...';
    try {
      var mask = state.masks.find(m => m.id === state.editingMaskId);
      var key = getKeyFor(mask);
      var resp = await fetch('/api/models?key=' + encodeURIComponent(key));
      if (!resp.ok) throw new Error('HTTP ' + resp.status);
      var ids = await resp.json();
      if (!Array.isArray(ids) || ids.length === 0) throw new Error('No models returned');
      state.availableModels = ids;
      alert('Synced ' + ids.length + ' models from OpenRouter.');
    } catch (err) {
      alert('Failed to sync models: ' + err.message + '\nUsing default model list.');
    }
    btn.disabled = false;
    btn.innerHTML = original;
    renderAgentsForm();
  });

  document.getElementById('drawerToggle').addEventListener('click', function () {
    document.getElementById('drawer').classList.toggle('collapsed');
  });

  document.getElementById('globalKeyBtn').addEventListener('click', askGlobalKey);

  // ---------- ORCHESTRATION ----------
  async function runOrchestration() {
    var promptInput = document.getElementById('promptInput');
    var userPrompt = promptInput.value.trim();
    if (!userPrompt) { alert('Please enter a prompt.'); return; }
    var mask = getActiveMask();
    if (!mask) { alert('Select or create a Mask first.'); return; }
    if (mask.agents.length === 0) { alert('Active mask has no agents.'); return; }

    var transcript = document.getElementById('transcript');
    var emptyState = document.getElementById('emptyState');
    if (emptyState) emptyState.remove();

    var userBubble = document.createElement('div');
    userBubble.className = 'user-bubble';
    userBubble.textContent = userPrompt;
    transcript.appendChild(userBubble);

    var loading = document.createElement('div');
    loading.className = 'loading-status';
    loading.textContent = '\u26A1 Running parallel agents across Cloudflare Edge...';
    transcript.appendChild(loading);
    transcript.scrollTop = transcript.scrollHeight;

    promptInput.value = '';
    var sendBtn = document.getElementById('sendBtn');
    sendBtn.disabled = true;

    try {
      var resp = await fetch('/api/orchestrate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userPrompt: userPrompt, mask: { globalPrompt: mask.globalPrompt, apiKey: getKeyFor(mask), agents: mask.agents } })
      });
      var data = await resp.json();
      if (!resp.ok) throw new Error(data.error || ('HTTP ' + resp.status));

      loading.remove();
      renderResponseBlock(transcript, data.results);
    } catch (err) {
      loading.remove();
      var errDiv = document.createElement('div');
      errDiv.className = 'agent-error';
      errDiv.style.alignSelf = 'center';
      errDiv.textContent = 'Orchestration failed: ' + err.message;
      transcript.appendChild(errDiv);
    }
    sendBtn.disabled = false;
    transcript.scrollTop = transcript.scrollHeight;
  }

  function renderResponseBlock(transcript, results) {
    var block = document.createElement('div');
    block.className = 'response-block';

    var toolbar = document.createElement('div');
    toolbar.className = 'response-toolbar';
    var pdfBtn = document.createElement('button');
    pdfBtn.className = 'pdf-btn';
    pdfBtn.innerHTML = '\uD83D\uDCE5 DOWNLOAD COMPLETE MULTI-PAGE PDF REPORT';
    pdfBtn.addEventListener('click', function () { generatePdf(block); });
    toolbar.appendChild(pdfBtn);
    block.appendChild(toolbar);

    var grid = document.createElement('div');
    grid.className = 'agent-grid';
    results.forEach(function (r) {
      var card = document.createElement('div');
      card.className = 'agent-output-card';
      var title = document.createElement('div');
      title.className = 'agent-output-title';
      title.textContent = r.agentTitle;
      var model = document.createElement('div');
      model.className = 'agent-output-model';
      model = r.model;
      var body = document.createElement('div');
      body.className = 'agent-output-body';
      if (r.error) {
        body.innerHTML = '<div class="agent-error">Error: ' + escapeHtml(r.error) + '</div>';
      } else {
        body.innerHTML = marked.parse(r.output || '');
      }
      card.appendChild(title); card.appendChild(model); card.appendChild(body);
      grid.appendChild(card);
    });
    block.appendChild(grid);
    transcript.appendChild(block);

    if (window.mermaid) {
      mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
      mermaid.run({ nodes: block.querySelectorAll('.mermaid }).catch(function () {});
    }
  }

  async function generatePdf(block) {
    var clone = block.cloneNode(true);
    clone.querySelector('.response-toolbar') && clone.querySelector('.response-toolbar').remove();

    // Convert rendered mermaid SVGs to plain inline SVGs for print
    var svgs = clone.querySelectorAll('svg');
    svgs.forEach(function (svg) {
      svg.removeAttribute('style');
      svg.style.maxWidth = '100%';
      svg.style.background = '#ffffff';
    });

    var wrapper = document.createElement('div');
    wrapper.innerHTML =
      '<div style="text-align:center;border-bottom:3px solid #111;padding-bottom:10px;margin-bottom:20px;">' +
      '<h1 style="margin:0;font-size:22px;letter-spacing:2px;">MUTAYIEB DOSSIER REPORT</h1>' +
      '<div style="font-size:11px;color:#555;">Generated: ' + new Date().toLocaleString() + '</div></div>';
    wrapper.appendChild(clone);

    var printStyle = document.createElement('style');
    printStyle.textContent =
      '#pdf-temp *{color:#111 !important;background:transparent !important;}' +
      '#pdf-temp pre{background:#f4f4f4 !important;border:1px solid #ddd;}' +
      '#pdf-temp code{background:#f4f4f4 !important;}' +
      '#pdf-temp .agent-output-card{border:1px solid #ccc;border-radius:8px;padding:12px;margin-bottom:14px;page-break-inside:avoid;}' +
      '#pdf-temp .agent-output-title{color:#1d4ed8 !important;font-weight:bold;}' +
      '#pdf-temp table{border-collapse:collapse;width:100%;}' +
      '#pdf-temp th,#pdf-temp td{border:1px solid #999;padding:4px 6px;font-size:11px;}' +
      '#pdf-temp .mermaid{background:#fff !important';
    wrapper.id = 'pdf-temp';
    wrapper.style.cssText = 'position:fixed;left:-9999px;top:0;width:800px;background:#fff;color:#111;font-family:Segoe UI,Arial,sans-serif;font-size:12px;';
    wrapper.appendChild(printStyle);
    document.body.appendChild(wrapper);

    try {
      await html2pdf().set({
        margin: [12, 12, 14, 12],
        filename: 'MUTAYIEB-Report.pdf',
        image: { type: 'jpeg', quality: 0.95 },
        html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff' },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
      }).from(wrapper).save();
    } finally {
      document.body.removeChild(wrapper);
    }
  }

  document.getElementById('sendBtn').addEventListener('click', runOrchestration);
  document.getElementById('promptInput').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); runOrchestration(); }
  });

  // ---------- INIT ----------
  if (window.mermaid) {
    mermaid.initialize({ startOnLoad: false, theme: 'dark', securityLevel: 'loose' });
  }
  if (window.marked) {
    marked.setOptions({ breaks: true, gfm: true });
  }
  loadMasks();
  updateKeyBtn();
  renderMaskList();
  renderPills();
  renderEditor();
})();
</script>
</body>
</html>`;
