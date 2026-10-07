// Starts dist/index.js with no key on the live RPC and calls the two read tools.
// Run `npm run build` first. Usage: node scripts/smoke.mjs
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const env = { ...process.env };
delete env.DERBY_PRIVATE_KEY; // the smoke test is always read-only
const client = new Client({ name: "smoke", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: "inherit" }));
try {
  const { tools } = await client.listTools();
  console.log("tools:", tools.map((t) => t.name).join(", "));
  for (const [name, args] of [["derby_status", {}], ["derby_board", {}]]) {
    const r = await client.callTool({ name, arguments: args });
    console.log(`\n${name}${r.isError ? " (isError)" : ""}:`);
    console.log(JSON.stringify(r.structuredContent ?? r.content, null, 2));
    if (r.isError) process.exitCode = 1;
  }
} finally {
  await client.close();
}
