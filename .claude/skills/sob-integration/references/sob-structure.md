# SOB (SaaSOnboard) — platform structure reference

Everything the integration relies on. Read this when wiring calls or building the SOB dashboard config.

## Two directions
1. **App → SOB** via the `sob-connect-sdk` npm package (a partner "Connect API" client).
2. **SOB → App** via webhooks: in SOB you create a **Sync Target** (base URL + auth) with one
   **Endpoint per trigger**, each with a URL path and a **Body Template** of `{{variables}}`.

## The SDK (`sob-connect-sdk`) — App → SOB
- **ESM-only, requires Node ≥ 22** (uses native `fetch`). From CommonJS, `await import(...)` it.
- Init: `new SobConnectClient('./connect-bootstrap.json')` **or** `new SobConnectClient({ slug, base_url, token })`.
- Bootstrap file shape: `{ "slug": "...", "base_url": "https://devapi.saasonboard.com", "token": "..." }`.
- Methods:
  - `client.config.get()` → `{ workspace, access_levels[], user_types[] }`
  - `client.accessLevels.list()`, `client.userTypes.list()`
  - `client.users.list(params?)`, `.upsert(payload)`, `.get(email)`, `.update(email, payload)`,
    `.changeRole(email, accessLevelId)`, `.changeStatus(email, status)`, `.recordLogin(email)`, `.delete(email)`
- `UpsertUserPayload`: `{ email* , name* , access_level_id* , password?, first_name?, last_name?, user_type_id?, status? }`
  → **upsert/update DO accept a `password`** (so the app can push a signup password up to SOB).
- Errors: `AuthenticationError`, `AuthorizationError`, `NotFoundError`, `ValidationError`, `RateLimitError`,
  `SobConnectNetworkError` (all extend `SobConnectError`). Treat SDK calls as best-effort — never let a
  partner-API blip break the app's own auth.

Access levels & user types are **workspace-specific** — resolve slugs → ids via `config.get()`, don't hardcode ids.
(Example workspace seen: access levels Free Trial/Basic/Standard/Pro/White Label; user types Free User/Beta
Member/JV Partner/Customer/Agency Partner.)

## SOB → App webhooks

**Sync Target (connection):** Name, **Base URL** (e.g. `https://yourapp.com`), **Auth Type** (use **Bearer token**;
the token is injected on every endpoint automatically), Active. Endpoint URL paths are appended to the base URL.

**Per-event endpoints** — each has: Label, **Trigger** (dropdown), **Method** (POST), **URL Path**,
optional headers, **Body Template (JSON)**. Triggers seen: `User Created`, `User Updated`,
`Access Level Changed`, `user_status_changed`, `User Deleted`.

**Available Body Template variables** (this is the full set — there is **no `{{user.password}}`**):
```
{{user.id}}  {{user.email}}  {{user.first_name}}  {{user.last_name}}  {{user.full_name}}
{{user.phone}}  {{user.status}} (active/inactive)  {{user.created_at}} (ISO)
{{access_level.id}}  {{access_level.name}}  {{access_level.slug}}  {{access_level.external_value}} (tier mapping)
{{user_type.id}}  {{user_type.name}}
{{workspace.id}}  {{workspace.name}}
{{auth.token}} (connection auth token/API key)  {{auth.username}}  {{auth.password}} (connection basic-auth, NOT the user's)
```

### Recommended endpoint config to hand the user
Base URL = the deployed app; Auth = Bearer `<SOB_WEBHOOK_SECRET>`. All POST. URL paths:

| Trigger | URL Path | Body Template |
|---|---|---|
| User Created | `/api/sob/user-created` | `{"email":"{{user.email}}","full_name":"{{user.full_name}}","status":"{{user.status}}","access_level":"{{access_level.slug}}","access_level_id":"{{access_level.id}}","user_type":"{{user_type.name}}"}` |
| User Updated | `/api/sob/user-updated` | `{"email":"{{user.email}}","full_name":"{{user.full_name}}","status":"{{user.status}}","access_level":"{{access_level.slug}}"}` |
| Access Level Changed | `/api/sob/access-changed` | `{"email":"{{user.email}}","access_level":"{{access_level.slug}}","access_level_id":"{{access_level.id}}"}` |
| user_status_changed | `/api/sob/status-changed` | `{"email":"{{user.email}}","status":"{{user.status}}"}` |
| User Deleted | `/api/sob/user-deleted` | `{"email":"{{user.email}}"}` |

## The password reality (important)
SOB does **not** expose the end-user's plaintext password (no `{{user.password}}` variable), so no webhook
body can carry it. Consequences + the standard resolutions:
- Our webhook handler assigns a **default password** (env `SOB_DEFAULT_PASSWORD`, e.g. `Project123`) to users
  SOB creates without one, so they can log in. It never overwrites a user who already has a password.
- App-side signups push their real password UP to SOB via `users.upsert({...password})`.
- The "real" fix for SOB-owned passwords is SSO / SOB hosted login (workspace `login_url`), configured on SOB's side.

## Env vars the app needs
`SOB_TOKEN` (Connect token), `SOB_SLUG`, `SOB_BASE_URL`, `SOB_WEBHOOK_SECRET` (Bearer secret SOB sends),
`SOB_DEFAULT_PASSWORD` (optional), `SOB_DEFAULT_ACCESS_LEVEL` (slug, default `free-trial`),
`SOB_DEFAULT_USER_TYPE` (slug, default `customer`). Locally these come from a git-ignored `connect-bootstrap.json`.
The deploying agent is typically blocked from writing secret env vars — hand the user the exact command/dashboard step.
