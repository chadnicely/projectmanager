#!/usr/bin/env node
/*
 * Base MCP server — exposes every client endpoint of the Base app
 * (server.js at pm.nicelycontrol.com) as MCP tools over stdio.
 *
 * Config via env:
 *   BASE_URL    base origin (default https://pm.nicelycontrol.com)
 *   BASE_TOKEN  optional session token to start authenticated
 *
 * The SOB webhook endpoints (/api/sob/*) are intentionally NOT exposed — they are
 * inbound webhooks called BY SaaSOnboard (shared-secret auth), not client actions.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";

const BASE_URL = (process.env.BASE_URL || "https://pm.nicelycontrol.com").replace(/\/+$/, "");
let token = process.env.BASE_TOKEN || ""; // session token; set by login/signup, cleared by logout

async function api(path, { method = "GET", body, auth = false } = {}) {
  const headers = {};
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (auth && token) headers["Authorization"] = "Bearer " + token;
  const res = await fetch(BASE_URL + path, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, ok: res.ok, data };
}

const ok = (obj) => ({ content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const fail = (obj) => ({ isError: true, content: [{ type: "text", text: typeof obj === "string" ? obj : JSON.stringify(obj, null, 2) }] });
const need = () => (token ? null : fail("Not signed in. Call base_login (or base_signup) first, or set BASE_TOKEN."));

const server = new McpServer({ name: "base-mcp", version: "1.0.0" });

// GET /api/health — connectivity probe (public)
server.tool("base_health", "Check Base API + database connectivity (GET /api/health).", {}, async () => {
  const r = await api("/api/health");
  return r.ok ? ok(r.data) : fail(r.data);
});

// POST /api/signup — create an account
server.tool(
  "base_signup",
  "Create a Base account (POST /api/signup). On success the returned session token is stored for later authed calls.",
  { email: z.string().email(), password: z.string().min(6, "min 6 chars"), name: z.string().optional() },
  async ({ email, password, name }) => {
    const r = await api("/api/signup", { method: "POST", body: { email, password, name } });
    if (r.ok && r.data && r.data.token) token = r.data.token;
    return r.ok ? ok({ ok: true, user: r.data.user }) : fail(r.data);
  }
);

// POST /api/login — sign in
server.tool(
  "base_login",
  "Sign into a Base account (POST /api/login). Stores the session token for later authed calls.",
  { email: z.string().email(), password: z.string() },
  async ({ email, password }) => {
    const r = await api("/api/login", { method: "POST", body: { email, password } });
    if (r.ok && r.data && r.data.token) token = r.data.token;
    return r.ok ? ok({ ok: true, user: r.data.user }) : fail(r.data);
  }
);

// POST /api/logout — invalidate the current token
server.tool("base_logout", "Sign out — invalidate the current session token (POST /api/logout).", {}, async () => {
  const guard = need(); if (guard) return guard;
  const r = await api("/api/logout", { method: "POST", auth: true });
  token = "";
  return r.ok ? ok({ ok: true }) : fail(r.data);
});

// GET /api/me — current user
server.tool("base_me", "Get the currently signed-in Base user (GET /api/me).", {}, async () => {
  const guard = need(); if (guard) return guard;
  const r = await api("/api/me", { auth: true });
  return r.ok ? ok(r.data) : fail(r.data);
});

// GET /api/state — load workspace
server.tool(
  "base_get_state",
  "Load the signed-in user's workspace (GET /api/state): boards, groups, items, base tables, people, teams. Also reports whether it's a shared/read-only workspace.",
  {},
  async () => {
    const guard = need(); if (guard) return guard;
    const r = await api("/api/state", { auth: true });
    return r.ok ? ok(r.data) : fail(r.data);
  }
);

// ---- Granular, safe workspace edits (POST /api/op) ----
// Each does ONE validated thing server-side, so a whole-workspace overwrite is impossible.
async function op(args) {
  const guard = need(); if (guard) return guard;
  const r = await api("/api/op", { method: "POST", body: args, auth: true });
  return r.ok ? ok(r.data.result ?? r.data) : fail(r.data);
}

server.tool("base_list_boards", "List boards in your workspace with card counts.", {}, () => op({ op: "list_boards" }));

server.tool("base_get_board", "Read a board's groups and cards (card ids included, for editing).",
  { board: z.string().describe("Board name (or numeric index).") },
  ({ board }) => op({ op: "get_board", board }));

server.tool("base_create_board", "Create a new board in the active workspace.",
  { name: z.string() },
  ({ name }) => op({ op: "create_board", name }));

server.tool("base_create_group", "Add a group (column) to a board.",
  { board: z.string(), name: z.string() },
  ({ board, name }) => op({ op: "create_group", board, name }));

server.tool("base_add_card", "Add a card to a board group.",
  { board: z.string(), group: z.string().optional().describe("Group name; defaults to the first group."),
    name: z.string(), status: z.string().optional(), note: z.string().optional(),
    assignees: z.array(z.string()).optional().describe("Person ids.") },
  ({ board, group, name, status, note, assignees }) => op({ op: "add_card", board, group, name, status, note, assignees }));

server.tool("base_update_card", "Update a card's name / status / note / assignees (get the cardId from base_get_board).",
  { board: z.string(), cardId: z.union([z.string(), z.number()]),
    name: z.string().optional(), status: z.string().optional(), note: z.string().optional(), assignees: z.array(z.string()).optional() },
  ({ board, cardId, name, status, note, assignees }) => op({ op: "update_card", board, cardId, name, status, note, assignees }));

server.tool("base_move_card", "Move a card to another group on the same board.",
  { board: z.string(), cardId: z.union([z.string(), z.number()]), toGroup: z.string() },
  ({ board, cardId, toGroup }) => op({ op: "move_card", board, cardId, toGroup }));

server.tool("base_add_comment", "Add a comment to a card.",
  { board: z.string(), cardId: z.union([z.string(), z.number()]), text: z.string(), author: z.string().optional() },
  ({ board, cardId, text, author }) => op({ op: "add_comment", board, cardId, text, author }));

server.tool("base_delete_card", "Delete a card from a board.",
  { board: z.string(), cardId: z.union([z.string(), z.number()]) },
  ({ board, cardId }) => op({ op: "delete_card", board, cardId }));

await server.connect(new StdioServerTransport());
