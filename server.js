/* Plaky / Cadence — static server + MongoDB-backed state API.
   Serves this folder over HTTP and persists the app state to MongoDB Atlas.
   Usage: node server.js   (PORT env optional, default 4100)

   Config: reads MONGO_URI / DB_NAME from the environment, falling back to
   ./config.local.js (git-ignored). Credentials never reach the browser. */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { hashPassword, verifyPassword, newToken } = require('./auth.js');
const sob = require('./sob.js');   // SaaSOnboard (SOB) Connect — mirror users + access

const ROOT = __dirname;
const PUBLIC = path.join(ROOT, 'public');   // static assets live here (served by Vercel's CDN in prod)
const PORT = process.env.PORT || 4100;

// ---- config (env first, then local file) --------------------------------
let cfg = {};
try { cfg = require('./config.local.js'); } catch (_) { /* optional */ }
const MONGO_URI = process.env.MONGO_URI || cfg.MONGO_URI || '';
const DB_NAME   = process.env.DB_NAME   || cfg.DB_NAME   || 'projectmanager';
const STATE_COLLECTION = 'appstate';
const STATE_ID = 'main'; // legacy shared document (pre per-user isolation) — migrated on first read
const MEMBERSHIPS = 'memberships'; // email -> owner email of a workspace they've been invited into
// Each user gets their OWN workspace document, keyed by their account id (email).
const stateIdFor = user => 'user:' + user._id;

// Resolve which workspace a signed-in user reads: their own, unless they've been invited
// into someone else's (then that owner's shared workspace, read-only).
async function resolveOwner(db, me) {
  const mem = await db.collection(MEMBERSHIPS).findOne({ _id: me._id });
  if (mem && mem.owner && mem.owner !== me._id) return { ownerId: mem.owner, shared: true };
  return { ownerId: me._id, shared: false };
}
// Member emails invited into a workspace = the people in its directory that carry an email
// (excluding the owner themselves).
function memberEmailsOf(state, ownerEmail) {
  const out = [];
  const ppl = (state && Array.isArray(state.people)) ? state.people : [];
  for (const p of ppl) {
    const e = normEmail(p && p.email);
    if (e && e !== ownerEmail && !out.includes(e)) out.push(e);
  }
  return out;
}
const USERS = 'users';
const SESSIONS = 'sessions';
const SESSION_DAYS = 30;

// ---- lazy Mongo connection (reused across requests) ----------------------
let _clientPromise = null;
function getDb() {
  if (!MONGO_URI) return Promise.reject(new Error('No MONGO_URI configured'));
  if (!_clientPromise) {
    const { MongoClient } = require('mongodb');
    const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 8000 });
    _clientPromise = client.connect().then(c => c.db(DB_NAME)).catch(err => {
      _clientPromise = null; // allow retry on next request
      throw err;
    });
  }
  return _clientPromise;
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > limitBytes) { reject(new Error('Payload too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function readJson(req, limitBytes) {
  const raw = await readBody(req, limitBytes || 64 * 1024);
  try { return JSON.parse(raw); } catch (_) { return null; }
}

const normEmail = e => String(e || '').trim().toLowerCase();
const bearer = req => (req.headers['authorization'] || '').replace(/^Bearer\s+/i, '').trim();

// Resolve the session token on a request → user doc, or null if unauthenticated/expired.
async function authUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const db = await getDb();
  const sess = await db.collection(SESSIONS).findOne({ _id: token });
  if (!sess) return null;
  if (sess.expiresAt && new Date(sess.expiresAt) < new Date()) {
    await db.collection(SESSIONS).deleteOne({ _id: token }).catch(() => {});
    return null;
  }
  return db.collection(USERS).findOne({ _id: sess.email });
}

async function startSession(db, email) {
  const token = newToken();
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 864e5).toISOString();
  await db.collection(SESSIONS).insertOne({ _id: token, email, createdAt: new Date().toISOString(), expiresAt });
  return token;
}

const publicUser = u => ({ email: u._id, name: u.name || u._id });

// ---- API -----------------------------------------------------------------
async function handleApi(req, res, urlPath) {
  // GET /api/health — connectivity probe (public)
  if (urlPath === '/api/health' && req.method === 'GET') {
    try { await getDb().then(db => db.command({ ping: 1 })); return sendJson(res, 200, { ok: true, db: DB_NAME }); }
    catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
  }

  // SOB -> app webhooks. SOB posts one endpoint per event, so we accept any path under
  // /api/sob/ and take the event from the last path segment (e.g. /api/sob/user-created,
  // /api/sob/user-deleted). A single /api/sob/webhook with the event in the body also works.
  // Authenticated by a shared secret (the connection's Bearer auth in SOB), not a session.
  if (urlPath.startsWith('/api/sob/')) {
    const eventFromPath = decodeURIComponent(urlPath.slice('/api/sob/'.length)).replace(/\/+$/, '');
    if (req.method === 'GET') return sendJson(res, 200, { ok: true, service: 'project-manager', endpoint: eventFromPath || 'root', webhook: 'ready' }); // URL-verification ping
    if (req.method === 'POST') {
      if (!sob.verifyWebhookRequest(req)) return sendJson(res, 401, { error: 'Invalid or missing webhook secret' });
      try {
        const body = await readJson(req, 256 * 1024);
        if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Expected a JSON body' });
        const db = await getDb();
        const evt = (eventFromPath === 'webhook') ? '' : eventFromPath;   // /webhook -> event comes from body
        const result = await sob.applyWebhook(body, db, { hashPassword, normEmail, eventFromPath: evt });
        return sendJson(res, result.ok ? 200 : 400, result);
      } catch (e) { return sendJson(res, 500, { error: e.message }); }
    }
    return sendJson(res, 405, { error: 'Method not allowed' });
  }

  // POST /api/signup — create an account { email, password, name? }
  if (urlPath === '/api/signup' && req.method === 'POST') {
    try {
      const body = await readJson(req); if (!body) return sendJson(res, 400, { error: 'Invalid JSON' });
      const email = normEmail(body.email), password = String(body.password || '');
      if (!email || !password) return sendJson(res, 400, { error: 'Email and password required' });
      if (password.length < 6) return sendJson(res, 400, { error: 'Password must be at least 6 characters' });
      const db = await getDb();
      const exists = await db.collection(USERS).findOne({ _id: email });
      if (exists) return sendJson(res, 409, { error: 'An account with that email already exists' });
      const { salt, hash } = hashPassword(password);
      const name = (body.name || '').trim() || email;
      await db.collection(USERS).insertOne({ _id: email, name, salt, hash, createdAt: new Date().toISOString() });
      await sob.provisionUser({ email, name, password });   // SOB is the source of truth for accounts/access (best-effort)
      const token = await startSession(db, email);
      return sendJson(res, 200, { token, user: { email, name } });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // POST /api/login — { email, password } → { token, user }
  if (urlPath === '/api/login' && req.method === 'POST') {
    try {
      const body = await readJson(req); if (!body) return sendJson(res, 400, { error: 'Invalid JSON' });
      const email = normEmail(body.email), password = String(body.password || '');
      const db = await getDb();
      const u = await db.collection(USERS).findOne({ _id: email });
      if (!u || !u.salt || !u.hash) return sendJson(res, 401, { error: 'No password is set for this account yet.' });
      if (!verifyPassword(password, u.salt, u.hash)) return sendJson(res, 401, { error: 'Wrong email or password' });
      // SOB controls access. The webhooks keep u.sobStatus fresh, so gate on that (fast, no per-login SOB call).
      if (u.sobStatus && String(u.sobStatus).toLowerCase() !== 'active') {
        return sendJson(res, 403, { error: 'Your account is ' + u.sobStatus + ' in SOB.' });
      }
      const token = await startSession(db, email);
      sob.recordLogin(email);   // best-effort, don't block the login on it
      return sendJson(res, 200, { token, user: publicUser(u) });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // POST /api/logout — invalidate the current token
  if (urlPath === '/api/logout' && req.method === 'POST') {
    try { const db = await getDb(); const token = bearer(req); if (token) await db.collection(SESSIONS).deleteOne({ _id: token }); return sendJson(res, 200, { ok: true }); }
    catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // GET /api/me — current user from token
  if (urlPath === '/api/me' && req.method === 'GET') {
    try { const u = await authUser(req); if (!u) return sendJson(res, 401, { error: 'Not signed in' }); return sendJson(res, 200, { user: publicUser(u) }); }
    catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // Everything below requires authentication.
  let me;
  try { me = await authUser(req); } catch (e) { return sendJson(res, 503, { error: e.message }); }
  if (!me) return sendJson(res, 401, { error: 'Sign in required' });

  // GET /api/state — load THIS user's saved workspace (null if none yet)
  if (urlPath === '/api/state' && req.method === 'GET') {
    try {
      const db = await getDb();
      const { ownerId, shared } = await resolveOwner(db, me);
      if (shared) {
        // Invited member → read-only view of the owner's shared workspace.
        const sdoc = await db.collection(STATE_COLLECTION).findOne({ _id: 'user:' + ownerId });
        return sendJson(res, 200, { state: sdoc ? sdoc.state : null, updatedAt: sdoc ? sdoc.updatedAt : null,
          shared: true, owner: ownerId, you: me._id, readOnly: true });
      }
      const sid = stateIdFor(me);
      let doc = await db.collection(STATE_COLLECTION).findOne({ _id: sid });
      if (!doc) {
        // One-time migration off the legacy shared 'main' doc: only the user who last
        // edited it adopts it. Everyone else starts with a clean, empty workspace.
        const legacy = await db.collection(STATE_COLLECTION).findOne({ _id: STATE_ID });
        if (legacy && legacy.updatedBy === me._id) {
          doc = { _id: sid, state: legacy.state, updatedAt: legacy.updatedAt, updatedBy: me._id };
          await db.collection(STATE_COLLECTION).updateOne({ _id: sid },
            { $set: { state: legacy.state, updatedAt: legacy.updatedAt, updatedBy: me._id } }, { upsert: true }).catch(() => {});
          // Keep the legacy 'main' doc as a recoverable backup — it's never read by other
          // accounts (they key off their own id), so it can't leak. Mark it migrated instead.
          await db.collection(STATE_COLLECTION).updateOne({ _id: STATE_ID },
            { $set: { migratedTo: sid, migratedAt: new Date().toISOString() } }).catch(() => {});
        }
      }
      return sendJson(res, 200, { state: doc ? doc.state : null, updatedAt: doc ? doc.updatedAt : null,
        shared: false, owner: me._id, you: me._id });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // PUT /api/state — upsert the whole workspace state (owner only; members are read-only)
  if (urlPath === '/api/state' && req.method === 'PUT') {
    try {
      const raw = await readBody(req, 16 * 1024 * 1024); // 16 MB cap
      let state;
      try { state = JSON.parse(raw); } catch (_) { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      if (!state || typeof state !== 'object') return sendJson(res, 400, { error: 'Expected a state object' });
      const db = await getDb();
      const { shared } = await resolveOwner(db, me);
      if (shared) return sendJson(res, 403, { error: 'Read-only: this is a shared workspace you were invited to.' });
      const updatedAt = new Date().toISOString();
      await db.collection(STATE_COLLECTION).updateOne(
        { _id: stateIdFor(me) },
        { $set: { state, updatedAt, updatedBy: me._id } },
        { upsert: true }
      );
      // Keep the invite index in sync with the workspace's people directory.
      const members = memberEmailsOf(state, me._id);
      const mcol = db.collection(MEMBERSHIPS);
      for (const m of members) {
        await mcol.updateOne({ _id: m }, { $set: { _id: m, owner: me._id, updatedAt } }, { upsert: true }).catch(() => {});
      }
      await mcol.deleteMany({ owner: me._id, _id: { $nin: members } }).catch(() => {});
      return sendJson(res, 200, { ok: true, updatedAt });
    } catch (e) {
      const code = /too large/i.test(e.message) ? 413 : 503;
      return sendJson(res, code, { error: e.message });
    }
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---- static files --------------------------------------------------------
const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
};

// Preload static assets into memory at startup. The literal path.join(__dirname, 'public', '…')
// calls let Vercel's file tracer detect and bundle these files with the service.
const STATIC = {};
try { STATIC['/index.html'] = fs.readFileSync(path.join(__dirname, 'public', 'index.html')); } catch (_) {}
try { STATIC['/sw.js'] = fs.readFileSync(path.join(__dirname, 'public', 'sw.js')); } catch (_) {}
try { STATIC['/manifest.webmanifest'] = fs.readFileSync(path.join(__dirname, 'public', 'manifest.webmanifest')); } catch (_) {}
try { STATIC['/icon-192.png'] = fs.readFileSync(path.join(__dirname, 'public', 'icon-192.png')); } catch (_) {}
try { STATIC['/icon-512.png'] = fs.readFileSync(path.join(__dirname, 'public', 'icon-512.png')); } catch (_) {}

function requestHandler(req, res) {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch(e => sendJson(res, 500, { error: e.message }));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';

  // Serve from the in-memory static map (works both locally and bundled on Vercel).
  const cached = STATIC[urlPath];
  if (cached) {
    const ext = path.extname(urlPath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    return res.end(cached);
  }
  // On disk fallback (covers any asset not preloaded, e.g. during local dev).
  const filePath = path.join(PUBLIC, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback to index.html for unknown routes
      if (STATIC['/index.html']) { res.writeHead(200, { 'Content-Type': TYPES['.html'] }); return res.end(STATIC['/index.html']); }
      res.writeHead(404); return res.end('Not found');
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': TYPES[ext] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
}

// Export the request handler (callable) so a host can also use it as a handler if needed.
module.exports = requestHandler;
module.exports.handleApi = handleApi;
module.exports.requestHandler = requestHandler;

// Only start a long-running HTTP server when run directly (`node server.js`).
if (require.main === module) {
  http.createServer(requestHandler).listen(PORT, () => {
    console.log(`Plaky running at http://localhost:${PORT}`);
    console.log(MONGO_URI ? `MongoDB: ${DB_NAME} (state API enabled)` : 'MongoDB: not configured (state API disabled)');
  });
}
