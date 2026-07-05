# Cadence — Project Center

A single-page suite of three apps that share one team, workspaces, and data store:

- **Boards** — Monday/Plaky-style project boards (table + Kanban)
- **Base** — Airtable-style database grid
- **Time** — Time-Doctor-style time tracker

Plain HTML/CSS/vanilla JS (`index.html`), served by a tiny dependency-light Node
server (`server.js`) that also exposes a MongoDB-backed state API.

## Run locally

```bash
npm install
# set the DB connection (or create config.local.js — see below)
MONGO_URI="mongodb+srv://…/projectmanager" node server.js
# open http://localhost:4100
```

`config.local.js` (git-ignored) can hold the connection string instead of an env var:

```js
module.exports = {
  MONGO_URI: 'mongodb+srv://…/projectmanager',
  DB_NAME: 'projectmanager',
};
```

## Deploy (Render)

1. Push this repo to GitHub.
2. In Render: **New → Web Service**, connect the repo (or use the included `render.yaml`).
3. Build command `npm install`, start command `node server.js`.
4. Add an environment variable **`MONGO_URI`** with your Atlas connection string
   (and optionally `DB_NAME`). Render sets `PORT` automatically.
5. Deploy → you get a public URL. Everyone who opens it shares the same MongoDB data.

## State API

- `GET  /api/health` — DB connectivity probe
- `GET  /api/state`  — load the saved workspace (single shared document)
- `PUT  /api/state`  — save the whole workspace state

State is stored as one document (`appstate/main`) in the `projectmanager` database.
Per-user/tenant separation and auth are not implemented yet.
