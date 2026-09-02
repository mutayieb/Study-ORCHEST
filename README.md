# MUTAYIEB — Multi-Agent Orchestration Engine (Static)

A single-file, static web app that runs a squad of AI agents in parallel through **OpenRouter**.
No backend required — it talks to OpenRouter directly from the browser, so it can be hosted on
**GitHub Pages** or **Vercel** (static) for free.

Everything the old Cloudflare Worker did now happens in the browser:
- `GET /` → the whole app is this one `index.html`
- `GET /api/models` → replaced by a direct browser call to `https://openrouter.ai/api/v1/models`
- `POST /api/orchestrate` → replaced by `Promise.all` browser calls to `https://openrouter.ai/api/v1/chat/completions`
- CORS is handled by OpenRouter itself (it sends `Access-Control-Allow-Origin: *`)

## Features
- **Gmail login** (Google Identity Services) — masks + API key are saved per Google account
  in `localStorage`, so you enter your OpenRouter key **once** and never again.
- After you enter your key, **all available OpenRouter models are pulled automatically**
  and populate every agent's model dropdown.
- **Claude-style centered chat** with a beautiful **+ New Mask** button above the chatbox.
- Masks (max 10) and agents (max 10 per mask) with the exact default "MUTAYIEB Master Engine"
  and its 5 default agents.
- Markdown rendering (`marked`), Mermaid diagrams, and a one-click
  **MUTAYIEB DOSSIER REPORT PDF** download (`html2pdf`).

## 1) Deploy to GitHub Pages (free, no server)
1. Create a GitHub repo and upload `index.html` (the whole app is this one file).
2. Repo → **Settings → Pages** → Source: **Deploy from a branch** → select `main` / root.
3. Your app is live at `https://<username>.github.io/<repo>/`.
4. (Optional) Enable Google login — see below.

## 2) Deploy to Vercel (free)
### Static mode (recommended, simplest)
1. Create a Vercel project and import the folder containing `index.html`.
2. Vercel auto-detects a static site. Done — no config needed.
3. Your app is live at `https://<project>.vercel.app`.

### Optional: serverless proxy mode (key stays on the server)
1. The folder already includes `api/chat.js` (a Vercel serverless function) and `vercel.json`.
2. In Vercel → Project → **Settings → Environment Variables**, add `OPENROUTER_API_KEY`.
3. In `index.html`, set `USE_PROXY = true`.
4. Redeploy. Agent calls now go through `/api/chat` and the key never leaves the server.

## 3) Enable Gmail login (Google Identity Services)
1. Go to https://console.cloud.google.com/apis/credentials
2. **Create Credentials → OAuth client ID → Web application**.
3. Under **Authorized JavaScript origins**, add your deployed URL
   (e.g. `https://<username>.github.io` or `https://<project>.vercel.app`).
4. Copy the Client ID and paste it into `index.html` at the top of the script:
   `var GOOGLE_CLIENT_ID = "YOUR_GOOGLE_CLIENT_ID.apps.googleusercontent.com";`
5. Reload. The "Sign in with Google" button now appears.
   - Without a Client ID, the app still works in **Guest mode** (masks saved locally only).

## How the API key works
- You enter your OpenRouter key once after signing in.
- It is stored in `localStorage` under your account and used for every model sync and agent run.
- A mask can override it with its own **Custom API Key** field; leave it blank to use your account key.
- The key is never hardcoded in the file.

## Files
| File | Purpose |
|------|---------|
| `index.html` | The complete app (HTML + CSS + JS) — deploy this |
| `api/chat.js` | Optional Vercel serverless proxy (key on server) |
| `vercel.json` | Vercel config for the proxy |
| `README.md` | This file |
