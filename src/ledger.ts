import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Records the IMD (in wei) a wallet has spent on packs, so the cap survives restarts. */
export interface Ledger {
  spent(wallet: string): bigint;
  add(wallet: string, wei: bigint): void;
}

export class MemoryLedger implements Ledger {
  private readonly totals = new Map<string, bigint>();

  constructor(initial: Record<string, bigint> = {}) {
    for (const [wallet, wei] of Object.entries(initial)) this.totals.set(wallet.toLowerCase(), wei);
  }

  spent(wallet: string): bigint {
    return this.totals.get(wallet.toLowerCase()) ?? 0n;
  }

  add(wallet: string, wei: bigint): void {
    this.totals.set(wallet.toLowerCase(), this.spent(wallet) + wei);
  }
}

/** JSON file `{ "spent": { "<wallet>": "<wei>" } }`, rewritten atomically after every change. */
export class FileLedger implements Ledger {
  constructor(private readonly path: string) {}

  private read(): Record<string, string> {
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      return data && typeof data.spent === "object" && data.spent ? data.spent : {};
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      // A corrupt ledger must not silently reset the cap.
      throw new Error(`Spending ledger ${this.path} is unreadable; fix or remove it by hand.`);
    }
  }

  spent(wallet: string): bigint {
    return BigInt(this.read()[wallet.toLowerCase()] ?? "0");
  }

  add(wallet: string, wei: bigint): void {
    const spent = this.read();
    const key = wallet.toLowerCase();
    spent[key] = (BigInt(spent[key] ?? "0") + wei).toString();
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.tmp`;
    writeFileSync(tmp, JSON.stringify({ spent }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }
}
