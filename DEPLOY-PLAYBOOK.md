# Deploy Playbook — ship an app to `<NAME>.nicelycontrol.com` (Vercel + Cloudflare)

This is a paste-into-a-new-session runbook. It encodes gotchas already solved on the
`projectmanager` (Cadence) app so the next deploy doesn't repeat the trial-and-error.

> **When this applies:** a **custom Node.js server** (`server.js` that `.listen()`s and
> serves its own static files + JSON API, e.g. MongoDB-backed).
> **When it does NOT:** standard frameworks (Next.js, Vite/React static, etc.) — Vercel
> deploys those natively; skip the "service + preload" trick entirely.

---

## Accounts / constants
- **Vercel team (scope):** `pacino-bots-projects`
- **Cloudflare zone:** `nicelycontrol.com` — zone id `c96793db486c92845bfdded1c21d3ba9`
- **Vercel anycast IP** for A records: `76.76.21.21`
- **Domain pattern:** one subdomain per app → `<NAME>.nicelycontrol.com`

## The user provides
- Vercel API token, Cloudflare API token (scoped to the zone, DNS edit)
- App secrets (e.g. `MONGO_URI`) and the chosen `<NAME>`

## Security (do first)
- Write tokens to gitignored files `.vercel-token`, `.cf-token`; reference via
  `$(cat .vercel-token)` / `$(cat .cf-token)` — never put a token literally in a command.
- Add tokens + `config.local.js` + `.env*` to **both** `.gitignore` and `.vercelignore`.
- Remind the user to **rotate both tokens** when done.

## Architecture — critical gotchas
1. Run as a Vercel **"service"** (persistent Node server), NOT serverless functions.
   Serverless caps request bodies at **4.5MB**, which breaks saving large state/images.
   The service model has no such cap.
2. The service model does **NOT** serve `public/` as static CDN files — the server must.
   But Vercel only bundles files its tracer can SEE. So put static assets in `public/`
   and **preload them into memory at startup with LITERAL paths**, one line per file:
   ```js
   const STATIC = {};
   try { STATIC['/index.html'] = fs.readFileSync(path.join(__dirname,'public','index.html')); } catch(_){}
   // ...one line per static asset (sw.js, manifest, icons)...
   ```
   Serve from that map; fall back to `index.html` for unknown routes.
3. `server.js`: `module.exports = requestHandler;` (callable `(req,res)`), and only
   `.listen()` when `require.main === module`.

## vercel.json
```json
{
  "$schema": "https://openapi.vercel.sh/vercel.json",
  "services": { "<PROJECT>": { "root": ".", "runtime": "node", "entrypoint": "server.js" } },
  "rewrites": [ { "source": "/(.*)", "destination": { "type": "service", "service": "<PROJECT>" } } ]
}
```

## Steps (curl-verify after each)
1. Commit + push to the app's GitHub repo.
2. Link (project name lowercase, no spaces):
   `npx vercel@latest link --yes --scope pacino-bots-projects --project <PROJECT>`
3. Deploy:
   `VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest deploy --prod --yes --scope pacino-bots-projects`
   Test the `*.vercel.app` URL: `GET /` = 200 (real app); `GET /api/health` = JSON.
   If `/` is 404 but `/api` works → the static-preload (gotcha #2) is wrong.
4. Env vars: add non-secret (e.g. `DB_NAME`) via `vercel env add NAME production`.
   The **agent is blocked from writing SECRET values** (e.g. `MONGO_URI`) — hand the user
   the `vercel env add MONGO_URI production` command to run, or they use the dashboard.
   Redeploy after env changes.
5. Attach domain:
   `npx vercel@latest domains add <NAME>.nicelycontrol.com <PROJECT> --scope pacino-bots-projects`
6. Cloudflare A record (DNS-only / grey cloud) via API:
   ```bash
   curl -s -X POST "https://api.cloudflare.com/client/v4/zones/c96793db486c92845bfdded1c21d3ba9/dns_records" \
     -H "Authorization: Bearer $(cat .cf-token)" -H "Content-Type: application/json" \
     --data '{"type":"A","name":"<NAME>","content":"76.76.21.21","ttl":1,"proxied":false}'
   ```
7. Verify + force-issue cert (auto-issue is slow):
   `npx vercel@latest domains verify <NAME>.nicelycontrol.com --scope pacino-bots-projects`
   `npx vercel@latest certs issue  <NAME>.nicelycontrol.com --scope pacino-bots-projects`
8. Final: `https://<NAME>.nicelycontrol.com/` = 200 and `/api/health` = `{"ok":true}`.
   HTTP:80 200 but HTTPS SSL error → cert not issued yet; re-run `certs issue`, wait ~60s.

## MongoDB Atlas (if used)
Network Access → allow `0.0.0.0/0` (Vercel IPs are dynamic) or logins fail.

## Ongoing
- Redeploy anytime: `VERCEL_TOKEN=$(cat .vercel-token) npx vercel@latest deploy --prod --yes --scope pacino-bots-projects`
- For push-to-deploy (no token needed), connect the GitHub repo to the Vercel project
  once in the dashboard (Add New → Project → Import), then `git push` auto-deploys.
