import { homedir } from "node:os";
import { join } from "node:path";
import { parseEther } from "ethers";

export interface Config {
  /** Hard cap on IMD spent on packs per wallet, in wei. */
  maxImdWei: bigint;
  /** How long derby_swing waits for the house draw. */
  drawTimeoutMs: number;
  /** Compatibility for the stdio entry point's transaction timeout. */
  revealTimeoutMs?: number;
  /** Status polling interval for fake chains; real-chain polling is at least 1 second. */
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
export const DEFAULT_CONTRACT = "0x53d9aa0b925c5148bcc5f98f394872687f4c831c";

export function loadEnv(env: NodeJS.ProcessEnv = process.env): Env {
  let maxImdWei: bigint;
  try {
    maxImdWei = parseEther(env.DERBY_MAX_IMD?.trim() || "5");
  } catch {
    throw new Error("DERBY_MAX_IMD must be a non-negative decimal number of IMD, e.g. 5.");
  }
  const drawTimeoutMs = Number(env.DERBY_DRAW_TIMEOUT_MS?.trim() || "45000");
  if (!Number.isFinite(drawTimeoutMs) || drawTimeoutMs <= 0) {
    throw new Error("DERBY_DRAW_TIMEOUT_MS must be a positive number of milliseconds.");
  }
  return {
    privateKey: env.DERBY_PRIVATE_KEY?.trim() || undefined,
    rpcUrl: env.DERBY_RPC_URL?.trim() || DEFAULT_RPC_URL,
    contract: env.DERBY_CONTRACT?.trim() || DEFAULT_CONTRACT,
    ledgerPath: env.DERBY_LEDGER?.trim() || join(homedir(), ".swarm-derby-mcp", "ledger.json"),
    config: { maxImdWei, drawTimeoutMs, revealTimeoutMs: drawTimeoutMs, pollIntervalMs: 250 },
  };
}
