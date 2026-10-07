import { homedir } from "node:os";
import { join } from "node:path";
import { parseEther } from "ethers";

export interface Config {
  /** Hard cap on IMD spent on packs per wallet, in wei. */
  maxImdWei: bigint;
  /** How long derby_swing waits for the target block. */
  revealTimeoutMs: number;
  /** Block polling interval while waiting for the target block. */
  pollIntervalMs: number;
}

export interface Env {
  privateKey?: string;
  rpcUrl: string;
  contract: string;
  ledgerPath: string;
  config: Config;
}

export const DEFAULT_RPC_URL = "https://rpc.mainnet.chain.robinhood.com";
export const DEFAULT_CONTRACT = "0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C";

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  let maxImdWei: bigint;
  try {
    maxImdWei = parseEther(env.DERBY_MAX_IMD?.trim() || "5");
  } catch {
    throw new Error("DERBY_MAX_IMD must be a non-negative decimal number of IMD, e.g. 5.");
  }
  const revealTimeoutMs = Number(env.DERBY_REVEAL_TIMEOUT_MS?.trim() || "60000");
  if (!Number.isFinite(revealTimeoutMs) || revealTimeoutMs <= 0) {
    throw new Error("DERBY_REVEAL_TIMEOUT_MS must be a positive number of milliseconds.");
  }
  return {
    privateKey: env.DERBY_PRIVATE_KEY?.trim() || undefined,
    rpcUrl: env.DERBY_RPC_URL?.trim() || DEFAULT_RPC_URL,
    contract: env.DERBY_CONTRACT?.trim() || DEFAULT_CONTRACT,
    ledgerPath: env.DERBY_LEDGER?.trim() || join(homedir(), ".swarm-derby-mcp", "ledger.json"),
    config: { maxImdWei, revealTimeoutMs, pollIntervalMs: 250 },
  };
}
