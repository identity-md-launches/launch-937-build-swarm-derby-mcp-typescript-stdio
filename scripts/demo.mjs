// Plays the live game with real IMD. Run `npm run build` first.
// Usage: node scripts/demo.mjs (keeps DERBY_PRIVATE_KEY and the configured cap/ledger).
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fileURLToPath } from "node:url";

const entry = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const env = { ...process.env };
const client = new Client({ name: "demo", version: "0.0.0" });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [entry], env, stderr: "inherit" }));
const call = async (name, args = {}) => {
  const time = new Date().toISOString();
  const result = await client.callTool({ name, arguments: args });
  console.log(`\n${time} ${name} ${JSON.stringify(args)}${result.isError ? " (isError)" : ""}:`);
  console.log(JSON.stringify(result, null, 2));
  return result;
};
try {
  await call("derby_status");
  await call("derby_buy_pack", { packs: 1 });
  while (!(await call("derby_swing")).isError) { /* play until the tool refuses */ }
  await call("derby_buy_pack", { packs: 1 });
  await call("derby_board");
  await call("derby_status");
} finally {
  await client.close();
}
