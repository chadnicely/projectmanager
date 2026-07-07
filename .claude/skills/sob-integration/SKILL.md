---
name: sob-integration
description: >-
  Integrate an app with the SOB (SaaSOnboard) customer platform — mirror the app's users up to SOB
  and receive SOB's changes back via webhooks so SOB governs accounts, access levels, and status.
  Use this whenever the user says /sob-setup, "integrate SOB", "connect this to SaaSOnboard", "set up
  the SOB endpoints", "mirror users to SOB", "add the sob-connect-sdk", or wants SOB to control
  accounts/access for an app. Runs as a friendly step-by-step wizard: it checks the app's auth,
  asks for the SOB config, installs the SDK, writes the integration + webhook endpoints, and hands
  the user the exact SOB dashboard configuration. Works for a custom Node.js app that has its own
  signup/login and a users store (e.g. MongoDB). For other stacks, adapt the same steps.
---

# Integrate this app with SOB (SaaSOnboard)

Set up both directions of the integration and hand the user everything they need to finish in the SOB UI.
Treat this as a **conversation** — explain what each step does, ask for what you need, and don't dump all
the questions at once. Read `references/sob-structure.md` for the SOB API/webhook details and template
variables, and use `references/sob.js` as the starting module (copy + adapt, don't rewrite from scratch).

## 0) Confirm the shape of the app (before anything)
This skill assumes a **custom app with its own auth**: a signup + login flow and a users store you can read/
write (MongoDB in the reference). Quickly confirm:
- Where users are created/verified (find the signup + login handlers).
- The users collection/table and the password hashing helpers (e.g. `hashPassword`/`verifyPassword`).
If it's a framework with built-in auth (NextAuth, Clerk, Supabase Auth, etc.), stop and adapt — the SDK
calls and webhook logic are the same, but where you hook them in differs.

## 1) Gather the SOB config (ask the user)
SOB gives a small bootstrap file: `{ "slug", "base_url", "token" }`. Ask the user to point you at it (often
in Downloads) or paste the values. Then:
- Copy it into the project as **`connect-bootstrap.json`** and add it to **`.gitignore` and `.vercelignore`** —
  it holds a token, never commit it.
- Confirm the token works and see the workspace: run a tiny ESM script that does
  `new SobConnectClient('./connect-bootstrap.json').config.get()` and show the user their access levels +
  user types. (The SDK is ESM/Node≥22, so use a `.mjs` script or `node -e "import('sob-connect-sdk')...".`)

## 2) Install the SDK
`npm install sob-connect-sdk`. It needs **Node ≥ 22** — set `"engines": { "node": "22.x" }` in package.json so
the host uses 22 too. It's ESM-only; the integration module `import()`s it dynamically from CommonJS.

## 3) Add the integration module
Copy `references/sob.js` into the project (adapt the users-collection field names / hashing import to match
this app). It provides, all best-effort (fail-open so a SOB outage never blocks the app's own auth):
- `provisionUser({email,name,password})` — upsert into SOB (default access level / user type from env).
- `recordLogin(email)`, `getUser(email)`, `checkAccess(email)`.
- Inbound webhook helpers: `verifyWebhookRequest(req)`, `applyWebhook(body, db, { hashPassword, normEmail, eventFromPath })`.

## 4) Wire it into signup + login
- **Signup:** after creating the local user, `await sob.provisionUser({ email, name, password })` (pushes the
  real password UP to SOB).
- **Login:** verify the password locally as usual, then gate on the user's **local `sobStatus`** (kept fresh by
  webhooks): if it's anything other than `active`, return 403. Then `sob.recordLogin(email)` (best-effort).
  Also guard against a user with **no** salt/hash so login can't crash (return a clean 401).

## 5) Add the SOB → app webhook endpoints
Add a route matching `/api/sob/` (any subpath). The **event is taken from the last path segment**
(`/api/sob/user-created`, `/api/sob/user-deleted`, …) so SOB can point one endpoint per trigger at a clean URL.
- `GET` any of them → return `200 {ok:true, webhook:"ready"}` (SOB may verify the URL).
- `POST` → verify the shared secret (`sob.verifyWebhookRequest`), then `sob.applyWebhook(...)`.
Generate a strong **webhook secret** (`whsec_...`), store it in `connect-bootstrap.json` (`webhook_secret`) for
local dev, and it becomes the `SOB_WEBHOOK_SECRET` env var in prod.

## 6) Passwords — set expectations + default fallback
SOB does **not** send plaintext passwords (there's no `{{user.password}}` template variable — see the reference).
So users SOB *creates* arrive with no password. The module assigns a **default password**
(`SOB_DEFAULT_PASSWORD`, e.g. `Project123`) so they can still log in, and never overwrites a real one. Tell the
user this plainly, and that the proper long-term fix is SOB SSO / hosted login, or SOB being configured to send
passwords. Ask if they want a different default or the "set password on first login" flow instead.

## 7) Deploy config (the user does the secrets)
Env vars: `SOB_TOKEN`, `SOB_SLUG`, `SOB_BASE_URL`, `SOB_WEBHOOK_SECRET`, and optionally
`SOB_DEFAULT_PASSWORD` / `SOB_DEFAULT_ACCESS_LEVEL` / `SOB_DEFAULT_USER_TYPE`. Non-secret ones you can set;
for the **secret** ones the agent is usually blocked, so give the user the exact `env add` command (read from
`connect-bootstrap.json`, don't print the value) or the dashboard step. Ensure the host uses **Node 22**.

## 8) Hand the user the SOB dashboard config + test
Give them, copy-paste ready (full table in `references/sob-structure.md`):
- **Connection:** Base URL = the app URL, Auth = **Bearer** `<SOB_WEBHOOK_SECRET>`.
- **5 endpoints** (all POST): `user-created / user-updated / access-changed / status-changed / user-deleted`
  with their body templates using **real** SOB variables (`{{user.email}}`, `{{user.full_name}}`,
  `{{user.status}}`, `{{access_level.slug}}`, …).

Then verify end-to-end with curl:
- SDK connects (`config.get`), signup mirrors up (`users.get` shows the new user),
- webhook round-trip: `POST /api/sob/user-created` (with the secret) → the user can then log in,
  `POST /api/sob/status-changed` inactive → login now 403, `user-deleted` → gone.
Clean up any throwaway test users from both SOB and the local DB when done.

## Reusing on other projects
This whole folder is portable: copy `.claude/skills/sob-integration/` into another repo's `.claude/skills/`
(and the `/sob-setup` command), then run it there. The SOB workspace differs per app, so always re-run
`config.get()` to read that app's access levels / user types rather than assuming.
