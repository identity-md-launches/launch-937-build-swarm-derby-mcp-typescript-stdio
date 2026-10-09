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
    new FileLedger(path).add("0x" + "Ab".repeat(20), 5n);
    new FileLedger(path).add("0x" + "ab".repeat(20), 7n);
    assert.equal(new FileLedger(path).spent("0x" + "AB".repeat(20)), 12n);
    assert.equal(new FileLedger(path).spent("0x" + "cd".repeat(20)), 0n);
    assert.deepEqual(JSON.parse(readFileSync(path, "utf8")), { spent: { ["0x" + "ab".repeat(20)]: "12" } });
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
    assert.equal(e.config.drawTimeoutMs, 45000);
    assert.equal(e.privateKey, undefined);
    assert.equal(e.contract, "0x53d9aa0b925c5148bcc5f98f394872687f4c831c");
    assert.equal(e.config.pollIntervalMs, 250);
  });
  it("reads only the draw timeout setting and rejects invalid values", () => {
    assert.equal(loadEnv({ DERBY_DRAW_TIMEOUT_MS: "1234" }).config.drawTimeoutMs, 1234);
    assert.equal(loadEnv({ DERBY_REVEAL_TIMEOUT_MS: "1234" }).config.drawTimeoutMs, 45000);
    for (const value of ["0", "-1", "NaN", "Infinity"]) {
      assert.throws(() => loadEnv({ DERBY_DRAW_TIMEOUT_MS: value }), /DERBY_DRAW_TIMEOUT_MS/);
    }
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

for (const spent of [[], { ["0x" + "ab".repeat(20)]: "-100" }, { ["0x" + "ab".repeat(20)]: "1e18" }, { nope: "100" }, { ["0x" + "AB".repeat(20)]: "100" }, null]) {
  it(`rejects malformed ledger entries: ${JSON.stringify(spent)}`, () => {
    const path = join(mkdtempSync(join(tmpdir(), "ledger-")), "ledger.json");
    writeFileSync(path, JSON.stringify({ spent }));
    assert.throws(() => new FileLedger(path).spent("0x" + "ab".repeat(20)), /unreadable; fix or remove it by hand/);
  });
}

it("explains NoHouseKey and all new v2 errors", () => {
  assert.equal(explainError({ revert: { name: "NoHouseKey" } }), "The house draw is paused (no house key). Nothing was spent; try again later.");
  for (const name of ["DrawClosed", "BadDraw", "CommitUsed", "KeyNotReady", "KeyExpired"]) {
    assert.notEqual(explainError({ revert: { name } }), "[object Object]");
  }
});
