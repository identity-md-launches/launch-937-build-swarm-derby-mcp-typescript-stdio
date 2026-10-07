#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createChain } from "./chain.js";
import { loadEnv } from "./config.js";
import { FileLedger } from "./ledger.js";
import { createServer, SERVER_NAME, SERVER_VERSION } from "./server.js";

try {
  const env = loadEnv();
  const chain = createChain({ rpcUrl: env.rpcUrl, contract: env.contract, privateKey: env.privateKey, txTimeoutMs: env.config.revealTimeoutMs });
  const server = createServer({ chain, ledger: new FileLedger(env.ledgerPath), config: env.config });
  await server.connect(new StdioServerTransport());
  console.error(
    `${SERVER_NAME} ${SERVER_VERSION} running on stdio (${chain.wallet ? `play mode, wallet ${chain.wallet}` : "read-only: no DERBY_PRIVATE_KEY"})`,
  );
} catch (err) {
  console.error(`${SERVER_NAME} failed to start: ${err instanceof Error ? err.message : "unknown error"}`);
  process.exit(1);
}
