/* Spawns the MCP server, lists its tools, and calls base_health end-to-end. */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, "server.js")],
  env: { ...process.env },
});
const client = new Client({ name: "smoke", version: "1.0.0" });

const fails = [];
const check = (name, cond) => { console.log((cond ? "PASS" : "FAIL") + " — " + name); if (!cond) fails.push(name); };

await client.connect(transport);

const { tools } = await client.listTools();
const names = tools.map((t) => t.name).sort();
console.log("tools:", names.join(", "));
const expected = [
  "base_health", "base_signup", "base_login", "base_logout", "base_me", "base_get_state",
  "base_list_boards", "base_get_board", "base_create_board", "base_create_group",
  "base_add_card", "base_update_card", "base_move_card", "base_add_comment", "base_delete_card",
];
check("all expected tools registered", expected.every((n) => names.includes(n)));
check("dangerous base_set_state is NOT exposed", !names.includes("base_set_state"));

const health = await client.callTool({ name: "base_health", arguments: {} });
const txt = health.content?.[0]?.text || "";
check("base_health returns ok:true", /"ok"\s*:\s*true/.test(txt));

const me = await client.callTool({ name: "base_me", arguments: {} });
check("base_me without auth is a friendly error", !!me.isError);

await client.close();
console.log("\n" + (fails.length ? fails.length + " FAILED" : "ALL PASSED"));
process.exit(fails.length ? 1 : 0);
