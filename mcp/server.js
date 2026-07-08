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

// PUT /api/state — replace workspace
server.tool(
  "base_set_state",
  "Replace the signed-in user's workspace (PUT /api/state). Pass the FULL state object — this OVERWRITES the saved workspace, so read base_get_state first and send back a modified copy. Fails for read-only (invited) members.",
  { state: z.record(z.any()).describe("The complete workspace state object to save.") },
  async ({ state }) => {
    const guard = need(); if (guard) return guard;
    const r = await api("/api/state", { method: "PUT", body: state, auth: true });
    return r.ok ? ok(r.data) : fail(r.data);
  }
);

await server.connect(new StdioServerTransport());
