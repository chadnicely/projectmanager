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

// ---- Granular, validated workspace operations (safe alternative to whole-state PUT) ------
// Mirrors the client's data shape. Each op mutates `state` in place and returns
// { result, changed } or { error }. Used by /api/op (and the MCP) so an LLM makes
// surgical edits and can never overwrite/erase the whole workspace.
const DEFAULT_COLS_SRV = [
  { key: 'Hold', color: '#5f6b7a' }, { key: 'URGENT', color: '#e2445c' }, { key: 'In Cue', color: '#f0a020' },
  { key: 'Completed', color: '#a23bc7' }, { key: 'Next Up', color: '#2f9be0' }, { key: 'In Progress', color: '#3b5bdb' }, { key: 'Approved', color: '#40b869' },
];
function applyOp(state, body) {
  const op = String(body && body.op || '');
  const boards = state.boards || (state.boards = []);
  const nid = () => { state.nextId = (state.nextId || 1000) + 1; return state.nextId; };
  const lc = s => String(s == null ? '' : s).trim().toLowerCase();
  const findBoard = ref => {
    if (ref == null || ref === '') return boards[state.activeBoard || 0] || boards[0];
    if (typeof ref === 'number') return boards[ref];
    const r = lc(ref);
    return boards.find(b => lc(b.name) === r) || boards.find(b => lc(b.name).includes(r));
  };
  const findGroup = (bd, name) => { const r = lc(name), gs = bd.groups || []; return gs.find(g => lc(g.name) === r) || gs.find(g => lc(g.name).includes(r)); };
  const locate = (bd, id) => { for (const g of bd.groups || []) { const it = (g.items || []).find(x => String(x.id) === String(id)); if (it) return { it, g }; } return null; };
  const cardView = it => ({ id: it.id, name: it.name, status: it.status || '', assignees: it.assignees || [], comments: (it.commentList || []).length, files: (it.fileList || []).length });
  const newItem = (name, status, assignees) => ({
    id: nid(), name: String(name || '').trim() || 'Untitled', status: status || '', docs: 0, comments: 0, sub: false, person: false,
    link: '', linkText: '', created: '', createdAt: Date.now(), assignees: Array.isArray(assignees) ? assignees : [],
    labels: [], urls: [], commentList: [], fileList: [], subitemList: [], checklists: [], activityLog: [],
  });

  switch (op) {
    case 'list_boards':
      return { changed: false, result: boards.map((b, i) => ({ index: i, name: b.name, space: b.spaceId, groups: (b.groups || []).length, cards: (b.groups || []).reduce((n, g) => n + (g.items || []).length, 0) })) };
    case 'get_board': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      return { changed: false, result: { name: bd.name, groups: (bd.groups || []).map(g => ({ group: g.name, cards: (g.items || []).map(cardView) })) } };
    }
    case 'create_board': {
      const name = String(body.name || '').trim(); if (!name) return { error: 'name is required' };
      const sid = state.activeSpace || (state.spaces && state.spaces[0] && state.spaces[0].id) || 'sp1';
      boards.push({ name, spaceId: sid, columns: DEFAULT_COLS_SRV.map(c => ({ ...c })), groups: [{ id: 'g' + nid(), name: 'New Group', color: '#868e9c', collapsed: false, items: [] }] });
      return { changed: true, result: { ok: true, board: name, index: boards.length - 1 } };
    }
    case 'create_group': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      const name = String(body.name || '').trim(); if (!name) return { error: 'name is required' };
      bd.groups = bd.groups || []; bd.groups.push({ id: 'g' + nid(), name, color: '#868e9c', collapsed: false, items: [] });
      return { changed: true, result: { ok: true, board: bd.name, group: name } };
    }
    case 'add_card': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      bd.groups = bd.groups || [];
      let g = body.group ? findGroup(bd, body.group) : bd.groups[0];
      if (!g && body.group) { g = { id: 'g' + nid(), name: String(body.group), color: '#868e9c', collapsed: false, items: [] }; bd.groups.push(g); }
      if (!g) return { error: 'No group to add to (create one first)' };
      const it = newItem(body.name, body.status, body.assignees);
      if (body.note) it.description = String(body.note);
      g.items = g.items || []; g.items.push(it);
      return { changed: true, result: { ok: true, cardId: it.id, board: bd.name, group: g.name } };
    }
    case 'update_card': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
      if (body.name != null) f.it.name = String(body.name);
      if (body.status != null) f.it.status = String(body.status);
      if (body.note != null) f.it.description = String(body.note);
      if (Array.isArray(body.assignees)) f.it.assignees = body.assignees;
      return { changed: true, result: { ok: true, cardId: f.it.id } };
    }
    case 'move_card': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
      const g = findGroup(bd, body.toGroup); if (!g) return { error: 'Target group not found' };
      f.g.items = f.g.items.filter(x => x !== f.it); g.items = g.items || []; g.items.push(f.it);
      return { changed: true, result: { ok: true, cardId: f.it.id, toGroup: g.name } };
    }
    case 'add_comment': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
      const text = String(body.text || '').trim(); if (!text) return { error: 'text is required' };
      f.it.commentList = f.it.commentList || []; f.it.commentList.push({ id: nid(), author: body.author || 'Claude', at: new Date().toISOString(), text });
      return { changed: true, result: { ok: true, cardId: f.it.id, comments: f.it.commentList.length } };
    }
    case 'delete_card': {
      const bd = findBoard(body.board); if (!bd) return { error: 'Board not found' };
      const f = locate(bd, body.cardId); if (!f) return { error: 'Card not found' };
      f.g.items = f.g.items.filter(x => x !== f.it);
      return { changed: true, result: { ok: true, deleted: body.cardId } };
    }
    default:
      return { error: 'Unknown op: ' + op };
  }
}

// Load the caller's workspace, apply one op, save if it changed. Owner-only (members 403).
// Returns { code, body } for both /api/op and the /mcp endpoint.
async function runOp(db, me, body) {
  const { shared } = await resolveOwner(db, me);
  if (shared) return { code: 403, body: { error: 'Read-only shared workspace — use the web app.' } };
  const sid = stateIdFor(me);
  const doc = await db.collection(STATE_COLLECTION).findOne({ _id: sid });
  const state = doc && doc.state;
  if (!state) return { code: 409, body: { error: 'No workspace yet — open Base once to create it.' } };
  const r = applyOp(state, body);
  if (r.error) return { code: 400, body: { error: r.error } };
  if (r.changed) {
    const updatedAt = new Date().toISOString();
    await db.collection(STATE_COLLECTION).updateOne({ _id: sid }, { $set: { state, updatedAt, updatedBy: me._id } });
    return { code: 200, body: { ok: true, updatedAt, result: r.result } };
  }
  return { code: 200, body: { ok: true, result: r.result } };
}
const USERS = 'users';
const SESSIONS = 'sessions';
const APITOKENS = 'apitokens';   // long-lived personal API tokens (for the MCP / integrations)
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

// Resolve a Bearer token → user doc, or null. Accepts BOTH web session tokens and
// long-lived personal API tokens (for the MCP). The returned user is tagged with
// `_authVia` ('session' | 'apitoken') so sensitive actions can require a real login.
async function authUser(req) {
  const token = bearer(req);
  if (!token) return null;
  const db = await getDb();
  const sess = await db.collection(SESSIONS).findOne({ _id: token });
  if (sess) {
    if (sess.expiresAt && new Date(sess.expiresAt) < new Date()) {
      await db.collection(SESSIONS).deleteOne({ _id: token }).catch(() => {});
      return null;
    }
    const u = await db.collection(USERS).findOne({ _id: sess.email });
    if (u) u._authVia = 'session';
    return u;
  }
  // Not a session — try a personal API token (keyed by its secret).
  const apt = await db.collection(APITOKENS).findOne({ secret: token });
  if (apt) {
    db.collection(APITOKENS).updateOne({ _id: apt._id }, { $set: { lastUsedAt: new Date().toISOString() } }).catch(() => {});
    const u = await db.collection(USERS).findOne({ _id: apt.email });
    if (u) u._authVia = 'apitoken';
    return u;
  }
  return null;
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

  // ---- Personal API tokens (for the MCP / integrations) --------------------
  // Managed only from a real web session — an API token can't mint more tokens.
  if (urlPath === '/api/tokens' && req.method === 'GET') {
    try {
      const db = await getDb();
      const list = await db.collection(APITOKENS).find({ email: me._id }).toArray();
      const tokens = list.map(t => ({ id: t._id, name: t.name, createdAt: t.createdAt, lastUsedAt: t.lastUsedAt || null,
        preview: (t.secret || '').slice(0, 10) + '…' }));
      return sendJson(res, 200, { tokens });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }
  if (urlPath === '/api/tokens' && req.method === 'POST') {
    if (me._authVia !== 'session') return sendJson(res, 403, { error: 'Create API tokens from the web app while signed in.' });
    try {
      const body = await readJson(req) || {};
      const name = (String(body.name || '').trim() || 'Claude Code').slice(0, 60);
      const db = await getDb();
      const secret = 'bmk_' + newToken() + newToken();   // shown once, never returned again
      const id = newToken().slice(0, 16);
      await db.collection(APITOKENS).insertOne({ _id: id, secret, email: me._id, name, createdAt: new Date().toISOString(), lastUsedAt: null });
      return sendJson(res, 200, { id, name, token: secret });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }
  if (urlPath.startsWith('/api/tokens/') && req.method === 'DELETE') {
    if (me._authVia !== 'session') return sendJson(res, 403, { error: 'Revoke API tokens from the web app while signed in.' });
    try {
      const id = decodeURIComponent(urlPath.slice('/api/tokens/'.length)).replace(/\/+$/, '');
      const db = await getDb();
      await db.collection(APITOKENS).deleteOne({ _id: id, email: me._id });
      return sendJson(res, 200, { ok: true });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

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

  // POST /api/op — granular, validated workspace operations (safe alternative to PUT /api/state).
  // Body: { op, ...args }. Owner-only (invited members are read-only + must use the web app so
  // group-visibility rules aren't bypassed).
  if (urlPath === '/api/op' && req.method === 'POST') {
    try {
      const body = await readJson(req, 1 * 1024 * 1024);
      if (!body || typeof body !== 'object') return sendJson(res, 400, { error: 'Expected JSON { op, ... }' });
      const db = await getDb();
      const { code, body: out } = await runOp(db, me, body);
      return sendJson(res, code, out);
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  return sendJson(res, 404, { error: 'Unknown API route' });
}

// ---- MCP over HTTP (Streamable HTTP, JSON responses) ---------------------
// Hosted MCP endpoint at POST /mcp. Auth = a Base API token in the Authorization
// header. Exposes the same read + granular-edit tools as the local MCP.
const MCP_TOOLS = [
  { name: 'base_health', description: 'Check Base API + database connectivity.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_get_state', description: 'Full workspace snapshot (boards, base tables, people, teams).', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_list_boards', description: 'List boards with card counts.', inputSchema: { type: 'object', properties: {}, additionalProperties: false } },
  { name: 'base_get_board', description: "Read a board's groups and cards (card ids included).", inputSchema: { type: 'object', properties: { board: { type: 'string' } }, required: ['board'] } },
  { name: 'base_create_board', description: 'Create a new board.', inputSchema: { type: 'object', properties: { name: { type: 'string' } }, required: ['name'] } },
  { name: 'base_create_group', description: 'Add a group (column) to a board.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, name: { type: 'string' } }, required: ['board', 'name'] } },
  { name: 'base_add_card', description: 'Add a card to a board group.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, group: { type: 'string' }, name: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' }, assignees: { type: 'array', items: { type: 'string' } } }, required: ['board', 'name'] } },
  { name: 'base_update_card', description: "Update a card's name/status/note/assignees.", inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, name: { type: 'string' }, status: { type: 'string' }, note: { type: 'string' }, assignees: { type: 'array', items: { type: 'string' } } }, required: ['board', 'cardId'] } },
  { name: 'base_move_card', description: 'Move a card to another group.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, toGroup: { type: 'string' } }, required: ['board', 'cardId', 'toGroup'] } },
  { name: 'base_add_comment', description: 'Add a comment to a card.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {}, text: { type: 'string' }, author: { type: 'string' } }, required: ['board', 'cardId', 'text'] } },
  { name: 'base_delete_card', description: 'Delete a card.', inputSchema: { type: 'object', properties: { board: { type: 'string' }, cardId: {} }, required: ['board', 'cardId'] } },
];
async function mcpCallTool(db, me, name, args) {
  args = args || {};
  if (name === 'base_health') { await db.command({ ping: 1 }); return { content: [{ type: 'text', text: JSON.stringify({ ok: true, db: DB_NAME }) }] }; }
  if (!me) return { isError: true, content: [{ type: 'text', text: 'Unauthorized — put your Base API token in the Authorization: Bearer header.' }] };
  if (name === 'base_get_state') {
    const { shared, ownerId } = await resolveOwner(db, me);
    const id = shared ? ('user:' + ownerId) : stateIdFor(me);
    const d = await db.collection(STATE_COLLECTION).findOne({ _id: id });
    return { content: [{ type: 'text', text: JSON.stringify(d ? d.state : null) }] };
  }
  const { code, body } = await runOp(db, me, { op: name.replace(/^base_/, ''), ...args });
  const payload = body.result !== undefined ? body.result : body;
  return { content: [{ type: 'text', text: JSON.stringify(payload) }], isError: code >= 400 };
}
async function handleMcp(req, res) {
  if (req.method !== 'POST') { res.writeHead(405, { 'Allow': 'POST', 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Use POST (JSON-RPC 2.0).' })); }
  let me = null;
  try { me = await authUser(req); } catch (_) { /* discovery still works unauth */ }
  let raw; try { raw = await readBody(req, 4 * 1024 * 1024); } catch (e) { return sendJson(res, 413, { error: e.message }); }
  let msg; try { msg = JSON.parse(raw); } catch (_) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } })); }
  let db = null; try { db = await getDb(); } catch (_) {}
  const handleOne = async (m) => {
    const id = (m && m.id !== undefined) ? m.id : null;
    const isNotif = !m || m.id === undefined || m.id === null;
    const reply = r => ({ jsonrpc: '2.0', id, result: r });
    const err = (code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });
    try {
      switch (m && m.method) {
        case 'initialize': return reply({ protocolVersion: (m.params && m.params.protocolVersion) || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'base-mcp', version: '1.0.0' } });
        case 'ping': return reply({});
        case 'tools/list': return reply({ tools: MCP_TOOLS });
        case 'tools/call': {
          const nm = m.params && m.params.name;
          if (!MCP_TOOLS.find(t => t.name === nm)) return err(-32601, 'Unknown tool: ' + nm);
          return reply(await mcpCallTool(db, me, nm, (m.params && m.params.arguments) || {}));
        }
        default: return isNotif ? null : err(-32601, 'Method not found: ' + (m && m.method));
      }
    } catch (e) { return err(-32603, e.message); }
  };
  if (Array.isArray(msg)) {
    const out = (await Promise.all(msg.map(handleOne))).filter(Boolean);
    if (!out.length) { res.writeHead(202); return res.end(); }
    res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
  }
  const out = await handleOne(msg);
  if (!out) { res.writeHead(202); return res.end(); }
  res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify(out));
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

  if (urlPath === '/mcp') {
    handleMcp(req, res).catch(e => { try { sendJson(res, 500, { jsonrpc: '2.0', id: null, error: { code: -32603, message: e.message } }); } catch (_) {} });
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
