# Base MCP server

An [MCP](https://modelcontextprotocol.io) server that exposes the Base app's HTTP
API (the `server.js` deployed at **pm.nicelycontrol.com**) as tools, so an MCP
client (Claude Code, Claude Desktop, etc.) can drive Base programmatically.

## Tools

**Auth / read**
| Tool | Purpose |
|------|---------|
| `base_health`    | DB connectivity probe (`GET /api/health`) |
| `base_signup` / `base_login` | authenticate; stores the token for later calls |
| `base_logout`    | invalidate the session |
| `base_me`        | current user |
| `base_get_state` | full workspace snapshot (read-only) |
| `base_list_boards` / `base_get_board` | list boards / read a board's groups + cards (with ids) |

**Safe granular edits** (via `POST /api/op` — each does one validated thing; there is **no**
whole-workspace overwrite tool, so an LLM can't wipe a workspace)
| Tool | Does |
|------|------|
| `base_create_board` / `base_create_group` | add a board / a group (column) |
| `base_add_card` | add a card to a group |
| `base_update_card` | change name / status / note / assignees |
| `base_move_card` | move a card to another group |
| `base_add_comment` | comment on a card |
| `base_delete_card` | delete a card |

> Not exposed: raw whole-state write, and the `/api/sob/*` webhooks (inbound, shared-secret).
> Edits require an **owner** token — invited (read-only) members are rejected.

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

1. Authenticate — set `BASE_TOKEN` (generate one in Base → profile → **Connect to Claude Code**), or call `base_login`.
2. `base_list_boards` → `base_get_board` to see cards + their ids.
3. Make changes with the granular tools, e.g. `base_add_card`, `base_move_card`, `base_update_card`.

Auth is per-process and in-memory (unless `BASE_TOKEN` is set): the login token lives only while the server runs.
