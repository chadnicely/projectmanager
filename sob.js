/* SOB (SaaSOnboard) Connect integration.
   Mirrors this app's users into SOB (accounts, passwords, access levels) and reads
   their access level / status so SOB is the source of truth for customers.

   Config: environment first (SOB_TOKEN / SOB_SLUG / SOB_BASE_URL) — set these on the host;
   otherwise falls back to ./connect-bootstrap.json (git-ignored) for local dev.

   The SDK is ESM-only + Node >=22, so we dynamic-import() it from this CommonJS module.
   Every call is best-effort: if SOB is unreachable we log and let the app keep working,
   rather than locking users out because a partner API blipped. */

let _clientPromise = null;
let _cfgPromise = null;

function sobConfig() {
  if (process.env.SOB_TOKEN) {
    return {
      token: process.env.SOB_TOKEN,
      slug: process.env.SOB_SLUG || 'project-manager',
      base_url: process.env.SOB_BASE_URL || 'https://devapi.saasonboard.com',
    };
  }
  try { return require('./connect-bootstrap.json'); } catch (_) { return null; }
}

function isConfigured() { return !!sobConfig(); }

function client() {
  if (!_clientPromise) {
    const cfg = sobConfig();
    if (!cfg) return Promise.reject(new Error('SOB not configured'));
    _clientPromise = import('sob-connect-sdk')
      .then(({ SobConnectClient }) => new SobConnectClient(cfg))
      .catch(err => { _clientPromise = null; throw err; });
  }
  return _clientPromise;
}

// Cache the workspace config so we can resolve access-level / user-type slugs -> ids.
function workspaceConfig() {
  if (!_cfgPromise) {
    _cfgPromise = client().then(c => c.config.get()).catch(err => { _cfgPromise = null; throw err; });
  }
  return _cfgPromise;
}

async function accessLevelIdBySlug(slug) {
  const cfg = await workspaceConfig();
  const lvl = (cfg.access_levels || []).find(a => a.slug === slug);
  return lvl ? lvl.id : undefined;
}
async function userTypeIdBySlug(slug) {
  const cfg = await workspaceConfig();
  const t = (cfg.user_types || []).find(u => u.slug === slug);
  return t ? t.id : undefined;
}

// New signups default to the Free Trial access level and the Customer user type.
const DEFAULT_ACCESS_LEVEL_SLUG = process.env.SOB_DEFAULT_ACCESS_LEVEL || 'free-trial';
const DEFAULT_USER_TYPE_SLUG   = process.env.SOB_DEFAULT_USER_TYPE   || 'customer';

// Create/update the user in SOB (source of truth). Returns the SOB user or null on failure.
async function provisionUser({ email, name, password }) {
  try {
    const c = await client();
    const access_level_id = await accessLevelIdBySlug(DEFAULT_ACCESS_LEVEL_SLUG);
    const user_type_id = await userTypeIdBySlug(DEFAULT_USER_TYPE_SLUG);
    const payload = { email, name: name || email };
    if (access_level_id != null) payload.access_level_id = access_level_id;
    if (user_type_id != null) payload.user_type_id = user_type_id;
    if (password) payload.password = password;
    return await c.users.upsert(payload);
  } catch (e) {
    console.warn('[SOB] provisionUser failed for', email, '-', e.name || '', e.message);
    return null;
  }
}

async function recordLogin(email) {
  try { const c = await client(); await c.users.recordLogin(email); }
  catch (e) { console.warn('[SOB] recordLogin failed for', email, '-', e.message); }
}

// Return the SOB user record (status, access_level_id, ...) or null if not found/unreachable.
async function getUser(email) {
  try { const c = await client(); return await c.users.get(email); }
  catch (e) { return null; }
}

async function updatePassword(email, password) {
  try { const c = await client(); await c.users.update(email, { password }); }
  catch (e) { console.warn('[SOB] updatePassword failed for', email, '-', e.message); }
}

// Access gate for login. Returns { allowed, reason, user }.
// Fails OPEN (allowed) when SOB is unreachable or the user isn't in SOB yet, so a partner-API
// outage never locks people out. Only an explicit inactive/suspended status blocks the login.
async function checkAccess(email) {
  try {
    const c = await client();
    const u = await c.users.get(email);
    if (u && (u.status === 'inactive' || u.status === 'suspended' || u.status === 'disabled')) {
      return { allowed: false, reason: 'Your account is ' + u.status + ' in SOB.', user: u };
    }
    return { allowed: true, user: u || null };
  } catch (e) {
    return { allowed: true, user: null }; // fail open
  }
}

// ---- Inbound webhooks: SOB -> this app ----------------------------------
// SOB calls POST /api/sob/webhook when it creates/updates/suspends/deletes a user
// or resets a password, so our local copy stays in sync with SOB (the source of truth).

function webhookSecret() {
  const cfg = sobConfig();
  return process.env.SOB_WEBHOOK_SECRET || (cfg && cfg.webhook_secret) || null;
}

// Accept the secret via Authorization: Bearer <secret>, or X-Sob-Secret / X-Webhook-Secret.
function verifyWebhookRequest(req) {
  const secret = webhookSecret();
  if (!secret) return false; // refuse if no secret configured — never run an open webhook
  const bearer = (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();
  const provided = bearer || req.headers['x-sob-secret'] || req.headers['x-webhook-secret'] || '';
  return !!provided && provided === secret;
}

// Apply one SOB event to the local users/sessions collections.
// SOB posts one endpoint per event, each with its own URL path and a custom body template,
// so we (a) take the event from the URL path (helpers.eventFromPath) or the body, and
// (b) read fields loosely — top-level or nested under `user`/`data`, and common name variants —
// so whatever body template is configured in SOB still maps correctly.
async function applyWebhook(body, db, helpers) {
  const { hashPassword, normEmail, eventFromPath } = helpers;
  const event = String(eventFromPath || body.event || body.type || '').toLowerCase();
  const u = { ...(body || {}), ...(body.user || body.data || {}) };  // merge nested + top-level

  const pick = (...keys) => { for (const k of keys) if (u[k] != null && u[k] !== '') return u[k]; return undefined; };
  const email = normEmail(pick('email', 'user_email') || '');
  if (!email) return { ok: false, error: 'missing user email', event };

  const users = db.collection('users');
  const sessions = db.collection('sessions');

  if (/delet|remove/.test(event)) {
    await users.deleteOne({ _id: email });
    await sessions.deleteMany({ email });
    return { ok: true, email, event, action: 'deleted' };
  }

  const set = {};
  const name = pick('name', 'full_name', 'fullName');            if (name != null) set.name = String(name);
  const status = pick('status', 'user_status');                 if (status != null) set.sobStatus = String(status);
  const accessId = pick('access_level_id');                     if (accessId != null) set.sobAccessLevelId = Number(accessId) || accessId;
  const plan = pick('plan', 'access_level', 'access_level_slug', 'access_level_value'); if (plan != null) set.sobPlan = String(plan);
  const userType = pick('user_type_id', 'user_type');           if (userType != null) set.sobUserType = userType;
  const password = pick('password');                            if (password) { const { salt, hash } = hashPassword(String(password)); set.salt = salt; set.hash = hash; }
  set.sobSyncedAt = new Date().toISOString();

  await users.updateOne(
    { _id: email },
    { $set: set, $setOnInsert: { _id: email, createdAt: new Date().toISOString() } },
    { upsert: true }
  );

  // Suspended/deactivated in SOB -> force-logout by clearing sessions.
  if (set.sobStatus && set.sobStatus.toLowerCase() !== 'active') {
    await sessions.deleteMany({ email });
  }
  return { ok: true, email, event, action: 'synced', fields: Object.keys(set) };
}

module.exports = {
  isConfigured, provisionUser, recordLogin, getUser, updatePassword, checkAccess,
  workspaceConfig, client,
  webhookSecret, verifyWebhookRequest, applyWebhook,
};
