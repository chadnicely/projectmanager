/* Checks the hosted MCP endpoint's OAuth discovery + auth gate. Point MCP_HTTP_BASE at a running server. */
const BASE = process.env.MCP_HTTP_BASE || "http://localhost:4110";
const fails = [];
const check = (n, c) => { console.log((c ? "PASS" : "FAIL") + " — " + n); if (!c) fails.push(n); };

(async () => {
  const as = await fetch(BASE + "/.well-known/oauth-authorization-server").then(r => r.json());
  check("authorization-server metadata", !!(as.authorization_endpoint && as.token_endpoint && as.registration_endpoint));
  const pr = await fetch(BASE + "/.well-known/oauth-protected-resource").then(r => r.json());
  check("protected-resource metadata points at /mcp", (pr.resource || "").endsWith("/mcp"));

  const un = await fetch(BASE + "/mcp", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize" }) });
  check("unauthenticated /mcp returns 401", un.status === 401);
  check("401 includes WWW-Authenticate resource_metadata (triggers OAuth)", /resource_metadata=/.test(un.headers.get("www-authenticate") || ""));

  console.log("\n" + (fails.length ? fails.length + " FAILED" : "ALL PASSED"));
  process.exit(fails.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
