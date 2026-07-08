# Base MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the Base app's HTTP
API (the `server.js` deployed at **pm.nicelycontrol.com**) as tools, so an MCP
client (Claude Code, Claude Desktop, etc.) can drive Base programmatically.

## Tools (one per client endpoint)

| Tool | Endpoint | Auth | Notes |
|------|----------|------|-------|
| `base_health`    | `GET /api/health`  | – | DB connectivity probe |
| `base_signup`    | `POST /api/signup` | – | stores the returned token |
| `base_login`     | `POST /api/login`  | – | stores the returned token |
| `base_logout`    | `POST /api/logout` | token | clears the token |
| `base_me`        | `GET /api/me`      | token | current user |
| `base_get_state` | `GET /api/state`   | token | full workspace (boards/base/people/teams) |
| `base_set_state` | `PUT /api/state`   | token | **overwrites** the workspace; read first, then send a modified copy |

> The `/api/sob/*` endpoints are **not** exposed — they're inbound webhooks called
> by SaaSOnboard (shared-secret auth), not client actions.

## Install

```bash
cd mcp
npm install
npm run smoke   # spawns the server, lists tools, calls base_health
```

## Configure

Environment:
- `BASE_URL` — API origin (default `https://pm.nicelycontrol.com`; use `http://localhost:4100` for local dev)
- `BASE_TOKEN` — optional session token to start authenticated (otherwise call `base_login`)

### Claude Code (`.mcp.json` or user config)

```json
{
  "mcpServers": {
    "base": {
      "command": "node",
      "args": ["<abs-path>/mcp/server.js"],
      "env": { "BASE_URL": "https://pm.nicelycontrol.com" }
    }
  }
}
```

### Claude Desktop (`claude_desktop_config.json`)

Same `mcpServers` block as above.

## Typical flow

1. `base_login` with your email/password (stores the token in-process).
2. `base_get_state` to read your workspace.
3. Modify the returned state object, then `base_set_state` with the full object to save.

Auth is per-process and in-memory: the token lives only while the server runs.
