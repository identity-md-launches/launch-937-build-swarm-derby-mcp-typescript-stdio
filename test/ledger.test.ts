import { strict as assert } from "node:assert";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import { explainError } from "../src/chain.js";
import { loadEnv } from "../src/config.js";
import { FileLedger } from "../src/ledger.js";

describe("FileLedger", () => {
  it("persists spend per wallet across instances", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "sub", "ledger.json");
    new FileLedger(path).add("0xAbC", 5n);
    new FileLedger(path).add("0xabc", 7n);
    assert.equal(new FileLedger(path).spent("0xABC"), 12n);
    assert.equal(new FileLedger(path).spent("0xdef"), 0n);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { spent: { "0xabc": "12" } });
  });

  it("refuses to reset the cap on a corrupt file", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.json");
    writeFileSync(path, "{nope");
    assert.throws(() => new FileLedger(path).spent("0x1"), /unreadable/);
  });
});

describe("loadEnv", () => {
  it("applies defaults", () => {
    const e = loadEnv({});
    assert.equal(e.config.maxImdWei, 5n * 10n ** 18n);
    assert.equal(e.config.revealTimeoutMs, 60000);
    assert.equal(e.privateKey, undefined);
  });
  it("rejects a bad cap", () => {
    assert.throws(() => loadEnv({ DERBY_MAX_IMD: "lots" }), /DERBY_MAX_IMD/);
  });
});

describe("explainError", () => {
  it("decodes custom errors into sentences", () => {
    assert.match(explainError({ revert: { name: "DayNotOver" } }), /not closed yet/);
    assert.match(explainError({ revert: { name: "NoTurns" } }), /derby_buy_pack/);
  });
});
