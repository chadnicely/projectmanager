/* Validates the hosted /mcp Streamable-HTTP endpoint. Point MCP_HTTP_URL at a running server. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const url = process.env.MCP_HTTP_URL || "http://localhost:4109/mcp";
const transport = new StreamableHTTPClientTransport(new URL(url));
const client = new Client({ name: "http-smoke", version: "1.0.0" });

const fails = [];
const check = (n, c) => { console.log((c ? "PASS" : "FAIL") + " — " + n); if (!c) fails.push(n); };

await client.connect(transport);
const { tools } = await client.listTools();
const names = tools.map(t => t.name).sort();
console.log("tools:", names.join(", "));
check("granular tools listed over HTTP", ["base_add_card", "base_get_board", "base_health", "base_list_boards", "base_move_card"].every(n => names.includes(n)));
check("no whole-state overwrite tool", !names.includes("base_set_state"));

const h = await client.callTool({ name: "base_health", arguments: {} });
check("base_health ok over HTTP", /"ok"\s*:\s*true/.test(h.content?.[0]?.text || ""));

const guarded = await client.callTool({ name: "base_list_boards", arguments: {} });
check("edit/read tool requires auth (friendly error, no crash)", !!guarded.isError);

await client.close();
console.log("\n" + (fails.length ? fails.length + " FAILED" : "ALL PASSED"));
process.exit(fails.length ? 1 : 0);
