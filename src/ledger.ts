import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

/** Records the IMD (in wei) a wallet has spent on packs, so the cap survives restarts. */
export interface Ledger {
  spent(wallet: string): bigint;
  add(wallet: string, wei: bigint): void;
  /** Atomically add a reservation if it would remain within the cap. */
  reserve?(wallet: string, wei: bigint, maxWei: bigint): boolean;
  /** Adjust a reservation after a receipt reveals the actual charged amount. */
  adjust?(wallet: string, deltaWei: bigint): void;
  /** Cross-process mutex for the check/reserve/broadcast sequence. */
  withSpendLock?<T>(fn: () => Promise<T>): Promise<T>;
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

  reserve(wallet: string, wei: bigint, maxWei: bigint): boolean {
    if (this.spent(wallet) + wei > maxWei) return false;
    this.add(wallet, wei);
    return true;
  }

  adjust(wallet: string, deltaWei: bigint): void {
    this.add(wallet, deltaWei);
  }
}

/** JSON file `{ "spent": { "<wallet>": "<wei>" } }`, rewritten atomically after every change. */
export class FileLedger implements Ledger {
  constructor(private readonly path: string) {}

  private write(spent: Record<string, string>): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const tmp = `${this.path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify({ spent }, null, 2) + "\n", { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, this.path);
  }

  private read(): Record<string, string> {
    try {
      const data = JSON.parse(readFileSync(this.path, "utf8"));
      if (!data || typeof data !== "object" || Array.isArray(data) ||
          !data.spent || typeof data.spent !== "object" || Array.isArray(data.spent)) {
        throw new Error("Invalid ledger shape.");
      }
      for (const [key, value] of Object.entries(data.spent)) {
        if (!/^0x[0-9a-f]{40}$/.test(key) || typeof value !== "string" || !/^[0-9]+$/.test(value)) {
          throw new Error("Invalid ledger entry.");
        }
      }
      return data.spent;
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
    this.write(spent);
  }

  reserve(wallet: string, wei: bigint, maxWei: bigint): boolean {
    const spent = this.read();
    const key = wallet.toLowerCase();
    const next = BigInt(spent[key] ?? "0") + wei;
    if (next > maxWei) return false;
    spent[key] = next.toString();
    this.write(spent);
    return true;
  }

  adjust(wallet: string, deltaWei: bigint): void {
    const spent = this.read();
    const key = wallet.toLowerCase();
    const next = BigInt(spent[key] ?? "0") + deltaWei;
    if (next < 0n) throw new Error("Spending ledger adjustment would become negative.");
    spent[key] = next.toString();
    this.write(spent);
  }

  async withSpendLock<T>(fn: () => Promise<T>): Promise<T> {
    const lock = `${this.path}.lock`;
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    let fd: number | undefined;
    for (;;) {
      try {
        fd = openSync(lock, "wx", 0o600);
        break;
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
        try {
          if (Date.now() - statSync(lock).mtimeMs > 120_000) unlinkSync(lock);
        } catch { /* another process owns or removed it */ }
        await new Promise((resolve) => setTimeout(resolve, 25));
      }
    }
    try {
      return await fn();
    } finally {
      closeSync(fd);
      try { unlinkSync(lock); } catch { /* already cleaned up */ }
    }
  }
}
