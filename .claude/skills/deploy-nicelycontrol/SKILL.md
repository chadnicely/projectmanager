---
name: deploy-nicelycontrol
description: >-
  Deploy a custom Node.js web app — a persistent server.js that serves its OWN static
  files plus a JSON API (e.g. MongoDB-backed) — to a subdomain of nicelycontrol.com on
  Vercel, with Cloudflare DNS and auto SSL. Use this whenever the user wants to put one of
  their Node apps online at <name>.nicelycontrol.com, "deploy to Vercel", "get it live",
  "ship this to production", set up / hand over a Vercel token, Cloudflare token, or project
  name for a deploy, or point a subdomain at an app. It gathers the tokens + project name +
  secrets and runs the whole deploy (Vercel service, DNS record, SSL). IMPORTANT: this is
  ONLY for custom Node servers that serve their own files. If the app is a standard framework
  (Next.js, Vite/React, plain static site), do NOT use this — Vercel deploys those natively
  and this skill's "service + preload" tricks are unnecessary and wrong.
---

# Deploy a Node app to `<name>.nicelycontrol.com`

This skill takes a **custom Node.js web app** live on a subdomain of `nicelycontrol.com`.
It exists because getting *this specific shape of app* onto Vercel has several non-obvious
traps that were already solved the hard way — this encodes the solutions so you don't
rediscover them.

## When this applies (and when it does NOT)

Use it when the app is a **persistent `server.js`** that calls `http.createServer(...).listen()`
and serves its own static files + a JSON API (typically MongoDB-backed). Signs: there's a
`server.js` with `.listen(PORT)`, static assets it reads with `fs.readFile`, and no framework.

Do **not** use it for Next.js, Vite/React, SvelteKit, or plain static sites. Vercel deploys
those natively; the "service + in-memory preload" steps below would break them. If you see a
`next.config.js`, a `vite.config.*`, or a `build` script that emits a `dist/`/`.next/`, stop
and deploy the normal Vercel way instead.

## Fixed values for this account

- **Vercel team / scope:** `pacino-bots-projects`
- **Cloudflare zone:** `nicelycontrol.com` — zone id `c96793db486c92845bfdded1c21d3ba9`
- **Vercel anycast IP** (for the DNS A record): `76.76.21.21`
- **Domain pattern:** one subdomain per app → `<name>.nicelycontrol.com`

## Step 0 — Gather inputs (ask the user)

Collect these before touching anything. Ask for whatever's missing:

1. **Subdomain / project name** — e.g. `crm` → `crm.nicelycontrol.com`. Vercel project names
   must be lowercase, no spaces (letters, digits, `.`, `_`, `-`).
2. **Vercel API token** — for the `pacino-bots-projects` team.
3. **Cloudflare API token** — scoped to the `nicelycontrol.com` zone with **DNS edit**
   ("Edit zone DNS" template → Specific zone → nicelycontrol.com). If the zone isn't in the
   dropdown when they create it, they're in the wrong Cloudflare account — the DNS lives in
   whichever account has nameservers `gerardo`/`tegan.ns.cloudflare.com`.
4. **App secrets** — e.g. `MONGO_URI`, `DB_NAME`. You will NOT be able to write the secret
   ones yourself (see Step 5); plan to hand them the command.

**Security — do this first and keep it true throughout:**
- Write each token to a gitignored file: `printf %s '<token>' > .vercel-token` and `.cf-token`.
- Add `.vercel-token`, `.cf-token`, `.vercel/`, `config.local.js`, `.env*` to **both**
  `.gitignore` and `.vercelignore`. Never put a token literally in a shell command — read it
  with `$(cat .vercel-token)` / `$(cat .cf-token)`. When you must show a secret's value to the
  user (e.g. a Mongo URI they need to paste), have them copy it from their own config file
  rather than you printing it.
- At the very end, **remind the user to rotate both tokens** since they passed through chat.

Validate the Vercel token early: `VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest whoami`.

## The three gotchas that make this work

Read these before running — they're why the steps are shaped the way they are.

1. **Deploy as a Vercel "service", not serverless.** Vercel Serverless Functions cap the
   request body at **4.5 MB**. Apps that save their whole state (including base64 images) in
   one `PUT` will silently fail once there are a couple of images. Running `server.js` as a
   persistent "service" has no such cap and needs no refactor.

2. **The service does NOT get `public/` served for free — the server must serve it, and Vercel
   only bundles files its tracer can SEE.** So: put static assets in `public/`, and in
   `server.js` preload them into memory at startup using *literal* paths so the bundler
   detects them:
   ```js
   const STATIC = {};
   try { STATIC['/index.html'] = fs.readFileSync(path.join(__dirname,'public','index.html')); } catch(_){}
   // ...one line per asset (sw.js, manifest, icons)...
   ```
   Then serve requests from `STATIC` (fall back to `index.html` for unknown routes). A dynamic
   `fs.readFile(somePath)` is invisible to the tracer, so those files won't ship — that's the
   trap. (Symptom if you get this wrong: `/api/*` works but `/` returns 404.)

3. **`server.js` must be importable AND runnable.** End it with:
   ```js
   module.exports = requestHandler;                 // callable (req,res)
   if (require.main === module) { http.createServer(requestHandler).listen(PORT, ...); }
   ```

### vercel.json
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": { "<PROJECT>": { "root": ".", "runtime": "node", "entrypoint": "server.js" } },
  "rewrites": [ { "source": "/(.*)", "destination": { "type": "service", "service": "<PROJECT>" } } ]
}
```
Do NOT add a top-level `functions` block — it conflicts with `services`.

## Step-by-step (verify each with curl before moving on)

1. **Prep the repo:** ensure `public/` holds the static assets and `server.js` preloads them
   (gotcha #2), the export/listen guard is in place (gotcha #3), and `vercel.json` exists.
   Commit and push to the app's GitHub repo (a first push to an empty repo is fine).

2. **Link the project** (creates it):
   ```bash
   npx vercel@latest link --yes --scope pacino-bots-projects --project <PROJECT>
   ```
   The new CLI auto-writes a `services` block into `vercel.json`; that's expected.

3. **Deploy:**
   ```bash
   VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest deploy --prod --yes --scope pacino-bots-projects
   ```
   Test the `*.vercel.app` URL: `GET /` → 200 with the real app; `GET /api/health` → JSON.
   If `/` is 404 but `/api` works, gotcha #2 is wrong — fix the preload and redeploy.

4. **Non-secret env vars** (e.g. `DB_NAME`):
   ```bash
   printf %s 'projectmanager' | VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest env add DB_NAME production --scope pacino-bots-projects
   ```

5. **Secret env vars (MONGO_URI) — the user does this, not you.** Writing a live credential to
   Vercel is blocked in auto mode, and that's correct. Hand the user the exact command to run
   in *their* terminal (PowerShell shown; it reads the value from their own config so nothing
   secret is typed):
   ```powershell
   $env:VERCEL_TOKEN = (Get-Content .vercel-token -Raw).Trim()
   node -e "process.stdout.write(require('./config.local.js').MONGO_URI)" | npx vercel@latest env add MONGO_URI production --scope pacino-bots-projects
   ```
   Or: Vercel dashboard → project → Settings → Environment Variables → add `MONGO_URI`
   (Production). **Env changes only apply on the next deploy — redeploy after.**

   ⚠️ Verify it points at the RIGHT database, not a placeholder. Vercel's edit form shows a
   greyed example `...@cluster.mongodb.net/app`; if the user saves *that*, the app connects to
   an empty DB and shows no data. Confirm the value ends in the real cluster/db.

6. **Attach the domain:**
   ```bash
   npx vercel@latest domains add <NAME>.nicelycontrol.com <PROJECT> --scope pacino-bots-projects
   ```

7. **Create the Cloudflare DNS record** (DNS-only / grey cloud — proxied breaks Vercel's cert):
   ```bash
   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/c96793db486c92845bfdded1c21d3ba9/dns_records" \
     -H "Authorization: Bearer $(cat .cf-token)" -H "Content-Type: application/json" \
     --data '{"type":"A","name":"<NAME>","content":"76.76.21.21","ttl":1,"proxied":false}'
   ```
   Use just `<NAME>` (e.g. `crm`), not the full domain — Cloudflare appends the zone.

8. **Verify + force-issue the cert** (auto-issue is slow; forcing is instant):
   ```bash
   npx vercel@latest domains verify <NAME>.nicelycontrol.com --scope pacino-bots-projects
   npx vercel@latest certs  issue  <NAME>.nicelycontrol.com --scope pacino-bots-projects
   ```

9. **Final check:** `https://<NAME>.nicelycontrol.com/` → 200 and `/api/health` → healthy.
   If plain HTTP (port 80) returns 200 but HTTPS fails with an SSL error, the cert just isn't
   issued yet — re-run `certs issue` and wait ~30–60s.

## MongoDB Atlas (if the app uses it)

Atlas must allow Vercel's dynamic IPs: **Network Access → Add IP → Allow from anywhere
(`0.0.0.0/0`)**, or every DB call fails with a connection error.

## Wrap up

- Confirm the live URL works, then **remind the user to rotate the Vercel + Cloudflare tokens**.
- For push-to-deploy later (a `git push` auto-deploys, no token needed), the user connects the
  GitHub repo to the Vercel project once in the dashboard (Add New → Project → Import).
- Reuse: `VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest deploy --prod --yes --scope pacino-bots-projects` redeploys anytime.
