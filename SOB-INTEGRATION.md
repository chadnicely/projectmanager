# SOB (SaaSOnboard) Integration

Two directions:
1. **App → SOB** (already wired via `sob-connect-sdk` in `sob.js`): on signup/login the app
   upserts the user into SOB, records logins, and blocks login if SOB marks them inactive.
2. **SOB → App** (the endpoint below): SOB calls our webhook when it creates/updates/suspends/
   deletes a user or resets a password, so our copy stays in sync with SOB (source of truth).

---

## Endpoints to register in SOB (one per trigger)

SOB posts a separate endpoint per event. Configure the **Sync Target** once, then add 5 endpoints.

**Sync Target (connection):**
- **Base URL:** `https://pm.nicelycontrol.com`  (local dev: `http://localhost:4100`)
- **Auth:** Bearer token = the shared secret (`SOB_WEBHOOK_SECRET`). SOB injects it on every endpoint.

**Endpoints** — all `POST`, `Content-Type: application/json`:

| SOB Trigger | URL Path | Body Template |
|---|---|---|
| User Created | `/api/sob/user-created` | `{"email":"{{user.email}}","full_name":"{{user.full_name}}","status":"{{user.status}}","access_level":"{{access_level.slug}}","password":"{{user.password}}"}` |
| User Updated | `/api/sob/user-updated` | `{"email":"{{user.email}}","full_name":"{{user.full_name}}","status":"{{user.status}}","access_level":"{{access_level.slug}}"}` |
| Access Level Changed | `/api/sob/access-changed` | `{"email":"{{user.email}}","access_level":"{{access_level.slug}}"}` |
| user_status_changed | `/api/sob/status-changed` | `{"email":"{{user.email}}","status":"{{user.status}}"}` |
| User Deleted | `/api/sob/user-deleted` | `{"email":"{{user.email}}"}` |

The event is taken from the **URL path**, so the body just carries the user fields. (A single
`/api/sob/webhook` with an `"event"` field in the body also works, if you prefer one endpoint.)

**Field mapping** — read loosely, so template variable names don't have to match exactly. Only
`email` is required:
| our field (any of these keys) | effect |
|---|---|
| `email` / `user_email` | identifies the user (required) |
| `name` / `full_name` | display name |
| `status` / `user_status` | stored; anything ≠ `active` **force-logs-out** the user and blocks login |
| `access_level` / `access_level_slug` / `access_level_value` / `access_level_id` | stored as the user's plan |
| `user_type` / `user_type_id` | stored |
| `password` | hashed + stored so the user can log into this app with it |

**Auth:** `Authorization: Bearer <SOB_WEBHOOK_SECRET>` (or header `X-Sob-Secret`). Wrong/missing → `401`.
**Verification ping:** SOB may `GET` any of these URLs first — we return `200 {ok:true, webhook:"ready"}`.
**Responses:** `200 {ok:true, action:"synced"|"deleted"}`, `401` bad secret, `400/500` on error.

> Note on `{{user.password}}`: if SOB exposes the password as a template variable, include it so
> SOB-created users can log in here directly. If SOB does NOT expose passwords (common, for
> security), those users won't have a local password — logging them in requires SOB's hosted
> login / SSO (your workspace `login_url`, currently empty). Everything else works regardless.

---

## Config the app needs (env vars on the host)

| var | purpose |
|---|---|
| `SOB_TOKEN` | Connect API token (app → SOB). Locally read from `connect-bootstrap.json`. |
| `SOB_SLUG` | `project-manager` (default) |
| `SOB_BASE_URL` | `https://devapi.saasonboard.com` (default) |
| `SOB_WEBHOOK_SECRET` | the shared secret SOB sends on webhooks (SOB → app) |
| `SOB_DEFAULT_ACCESS_LEVEL` | slug for new signups (default `free-trial`) |
| `SOB_DEFAULT_USER_TYPE` | slug for new signups (default `customer`) |

Locally these come from `connect-bootstrap.json` (git-ignored). In production set them as Vercel
env vars and redeploy. Requires **Node 22** on the host (the SDK is Node ≥22, ESM).

## Other app URLs SOB might want
- App / login page: `https://pm.nicelycontrol.com/`
- Health check: `GET https://pm.nicelycontrol.com/api/health`
