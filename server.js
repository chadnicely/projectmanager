/* Plaky / Cadence — static server + MongoDB-backed state API.
   Serves this folder over HTTP and persists the app state to MongoDB Atlas.
   Usage: node server.js   (PORT env optional, default 4100)

   Config: reads MONGO_URI / DB_NAME from the environment, falling back to
   ./config.local.js (git-ignored). Credentials never reach the browser. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = process.env.PORT || 4100;

// ---- config (env first, then local file) --------------------------------
let cfg = {};
try { cfg = require('./config.local.js'); } catch (_) { /* optional */ }
const MONGO_URI = process.env.MONGO_URI || cfg.MONGO_URI || '';
const DB_NAME   = process.env.DB_NAME   || cfg.DB_NAME   || 'projectmanager';
const STATE_COLLECTION = 'appstate';
const STATE_ID = 'main'; // single-workspace document for now

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

// ---- API -----------------------------------------------------------------
async function handleApi(req, res, urlPath) {
  // GET /api/health — connectivity probe
  if (urlPath === '/api/health' && req.method === 'GET') {
    try { await getDb().then(db => db.command({ ping: 1 })); return sendJson(res, 200, { ok: true, db: DB_NAME }); }
    catch (e) { return sendJson(res, 503, { ok: false, error: e.message }); }
  }

  // GET /api/state — load the saved workspace state (null if none yet)
  if (urlPath === '/api/state' && req.method === 'GET') {
    try {
      const db = await getDb();
      const doc = await db.collection(STATE_COLLECTION).findOne({ _id: STATE_ID });
      return sendJson(res, 200, { state: doc ? doc.state : null, updatedAt: doc ? doc.updatedAt : null });
    } catch (e) { return sendJson(res, 503, { error: e.message }); }
  }

  // PUT /api/state — upsert the whole workspace state
  if (urlPath === '/api/state' && req.method === 'PUT') {
    try {
      const raw = await readBody(req, 16 * 1024 * 1024); // 16 MB cap
      let state;
      try { state = JSON.parse(raw); } catch (_) { return sendJson(res, 400, { error: 'Invalid JSON' }); }
      if (!state || typeof state !== 'object') return sendJson(res, 400, { error: 'Expected a state object' });
      const db = await getDb();
      const updatedAt = new Date().toISOString();
      await db.collection(STATE_COLLECTION).updateOne(
        { _id: STATE_ID },
        { $set: { state, updatedAt } },
        { upsert: true }
      );
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

http.createServer((req, res) => {
  let urlPath = decodeURIComponent(req.url.split('?')[0]);

  if (urlPath.startsWith('/api/')) {
    handleApi(req, res, urlPath).catch(e => sendJson(res, 500, { error: e.message }));
    return;
  }

  if (urlPath === '/') urlPath = '/index.html';
  // prevent path traversal
  const filePath = path.join(ROOT, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      // SPA-ish fallback to index.html for unknown routes
      return fs.readFile(path.join(ROOT, 'index.html'), (e2, idx) => {
        if (e2) { res.writeHead(404); return res.end('Not found'); }
        res.writeHead(200, { 'Content-Type': TYPES['.html'] });
        res.end(idx);
      });
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': TYPES[ext] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
    });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Plaky running at http://localhost:${PORT}`);
  console.log(MONGO_URI ? `MongoDB: ${DB_NAME} (state API enabled)` : 'MongoDB: not configured (state API disabled)');
});
