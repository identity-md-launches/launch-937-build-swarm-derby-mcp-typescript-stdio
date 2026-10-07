import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { parseEther } from "ethers";
import type { Board, DerbyChain, League, PendingSwing, Settlement } from "../src/chain.js";
import type { Config } from "../src/config.js";
import { MemoryLedger } from "../src/ledger.js";
import { createServer } from "../src/server.js";

const WALLET = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const PRICE = parseEther("0.5");
const E = parseEther;

class FakeChain implements DerbyChain {
  wallet: string | undefined = WALLET;
  day = 20000n;
  imd = E("10");
  eth = E("0.01");
  allow = 0n;
  turnCount = 0n;
  score = 0n;
  board_: Board = { players: [OTHER, WALLET], scores: [900n, 400n] };
  settlement: Settlement = { exists: true, ready: true, day: 19999n, amount: E("3"), tip: E("0.01") };
  block = 100;
  blocksPerPoll = 3;
  stuck = false;
  swingTier = 4;
  revealFails = false;
  calls: string[] = [];
  approvals: bigint[] = [];

  async currentDay() { return this.day; }
  async packPrice() { return PRICE; }
  async imdBalance() { return this.imd; }
  async ethBalance() { return this.eth; }
  async allowance() { return this.allow; }
  async turns() { return this.turnCount; }
  async dayScore() { return this.score; }
  async board(_l: League, day: bigint) { return day === this.day ? this.board_ : { players: [], scores: [] }; }
  async dayPot() { return E("2"); }
  async nextSettlement() { return this.settlement; }
  async blockNumber() { if (!this.stuck) this.block += this.blocksPerPoll; return this.block; }
  async approve(amount: bigint) { this.calls.push("approve"); this.approvals.push(amount); this.allow = amount; return "0xapprove"; }
  async buyPacks(_l: League, packs: number) {
    this.calls.push("buyPacks");
    this.imd -= PRICE * BigInt(packs);
    this.turnCount += BigInt(packs) * 5n;
    return "0xbuy";
  }
  async commitSwing(): Promise<PendingSwing> {
    this.calls.push("swing");
    this.turnCount -= 1n;
    return {
      swingId: 42n,
      targetBlock: this.block + 5,
      commitTxHash: "0xcommit",
      reveal: async () => {
        this.calls.push("finalize");
        if (this.revealFails) throw new Error("The target block has not been mined yet.");
        if (this.swingTier >= 3) this.score += 450n;
        return { txHash: "0xfinal", tier: this.swingTier, feet: this.swingTier >= 3 ? 450 : 0 };
      },
    };
  }
  async settleNextDay() {
    this.calls.push("settle");
    return { txHash: "0xsettle", day: 19999n, winners: [OTHER, WALLET], amounts: [E("1.5"), E("0.5")], tip: E("0.01") };
  }
}

const CONFIG: Config = { maxImdWei: E("2"), revealTimeoutMs: 200, pollIntervalMs: 1 };

async function connect(chain = new FakeChain(), ledger = new MemoryLedger(), config = CONFIG) {
  const client = new Client({ name: "test-client", version: "0.0.0" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([createServer({ chain, ledger, config }).connect(st), client.connect(ct)]);
  const call = (name: string, args: Record<string, unknown> = {}) => client.callTool({ name, arguments: args });
  return { client, chain, ledger, call };
}

const text = (r: any) => (r.content as { text: string }[])[0].text;

describe("tools/list", () => {
  it("lists exactly the five tools with the requested inputs", async () => {
    const { client } = await connect();
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map((t) => t.name).sort(), ["derby_board", "derby_buy_pack", "derby_settle", "derby_status", "derby_swing"]);
    const schema = (n: string) => tools.find((t) => t.name === n)!.inputSchema as any;
    assert.deepEqual(schema("derby_status").properties ?? {}, {});
    assert.deepEqual(schema("derby_buy_pack").required, ["packs"]);
    assert.equal(schema("derby_buy_pack").properties.packs.maximum, 10);
    assert.equal(schema("derby_swing").properties.quality.default, 100);
    assert.equal(schema("derby_swing").properties.velo.minimum, 0);
    assert.equal(schema("derby_board").properties.league.default, "agent");
    assert.equal(schema("derby_board").required, undefined);
    assert.equal(schema("derby_settle").properties.league.default, "agent");
  });
});

describe("derby_status", () => {
  it("reports play mode with balances, score, rank and cap", async () => {
    const { call } = await connect();
    const r: any = await call("derby_status");
    assert.equal(r.isError, undefined);
    const s = r.structuredContent;
    assert.equal(s.mode, "play");
    assert.equal(s.wallet, WALLET);
    assert.equal(s.day, 20000);
    assert.equal(s.packPrice, "0.5");
    assert.equal(s.imdBalance, "10.0");
    assert.equal(s.todayRank, 2);
    assert.deepEqual(s.cap, { maxImd: "2.0", spentImd: "0.0", remainingImd: "2.0" });
  });

  it("is read-only without a key", async () => {
    const chain = new FakeChain();
    chain.wallet = undefined;
    const r: any = await (await connect(chain)).call("derby_status");
    assert.equal(r.structuredContent.mode, "read-only");
    assert.equal(r.structuredContent.agentTurns, null);
  });

  it("returns isError when the chain fails", async () => {
    const chain = new FakeChain();
    chain.packPrice = async () => { throw new Error("The Robinhood Chain RPC could not be reached; try again shortly."); };
    const r: any = await (await connect(chain)).call("derby_status");
    assert.equal(r.isError, true);
  });
});

describe("derby_board", () => {
  it("returns ranked rows, pot and next settlement", async () => {
    const r: any = await (await connect()).call("derby_board", {});
    const s = r.structuredContent;
    assert.deepEqual(s.rows, [{ rank: 1, player: OTHER, feet: 900 }, { rank: 2, player: WALLET, feet: 400 }]);
    assert.equal(s.dayPot, "2.0");
    assert.equal(s.nextSettlement.day, 19999);
    assert.equal(s.league, "agent");
  });

  it("refuses a future day", async () => {
    const r: any = await (await connect()).call("derby_board", { day: 20001 });
    assert.equal(r.isError, true);
    assert.match(text(r), /future/);
  });

  it("rejects a bad league", async () => {
    const r: any = await (await connect()).call("derby_board", { league: "minor" });
    assert.equal(r.isError, true);
  });
});

describe("derby_buy_pack", () => {
  it("approves exactly the cost, buys, and records the spend", async () => {
    const { call, chain, ledger } = await connect();
    const r: any = await call("derby_buy_pack", { packs: 2 });
    assert.equal(r.isError, undefined);
    assert.deepEqual(chain.approvals, [PRICE * 2n]);
    assert.deepEqual(chain.calls, ["approve", "buyPacks"]);
    assert.equal(r.structuredContent.costImd, "1.0");
    assert.equal(r.structuredContent.turnsAdded, 10);
    assert.deepEqual(r.structuredContent.txHashes, ["0xapprove", "0xbuy"]);
    assert.equal(ledger.spent(WALLET), PRICE * 2n);
    assert.equal(r.structuredContent.cap.remainingImd, "1.0");
  });

  it("skips the approval when the allowance already covers the cost", async () => {
    const chain = new FakeChain();
    chain.allow = E("100");
    const r: any = await (await connect(chain)).call("derby_buy_pack", { packs: 1 });
    assert.equal(r.isError, undefined);
    assert.deepEqual(chain.calls, ["buyPacks"]);
  });

  it("releases the cap reservation when buyPacks confirms a revert", async () => {
    const chain = new FakeChain();
    const buy = chain.buyPacks.bind(chain);
    const ledger = new MemoryLedger();
    chain.buyPacks = async () => {
      assert.equal(ledger.spent(WALLET), PRICE);
      throw Object.assign(new Error("Transaction 0xbuy reverted."), { confirmedNoCharge: true });
    };
    const { call } = await connect(chain, ledger, { ...CONFIG, maxImdWei: PRICE });
    const r: any = await call("derby_buy_pack", { packs: 1 });
    assert.equal(r.isError, true);
    assert.match(text(r), /reverted/);
    assert.equal(ledger.spent(WALLET), 0n);
    assert.equal(chain.imd, E("10"));
    assert.equal(chain.turnCount, 0n);
    chain.buyPacks = buy;
    assert.equal(((await call("derby_buy_pack", { packs: 1 })) as any).isError, undefined);
    assert.equal(ledger.spent(WALLET), PRICE);
  });

  it("refuses a buy past the cap before signing anything", async () => {
    const { call, chain, ledger } = await connect(new FakeChain(), new MemoryLedger({ [WALLET]: E("1.5") }));
    const r: any = await call("derby_buy_pack", { packs: 2 });
    assert.equal(r.isError, true);
    assert.match(text(r), /DERBY_MAX_IMD/);
    assert.deepEqual(chain.calls, []);
    assert.deepEqual(chain.approvals, []);
    assert.equal(ledger.spent(WALLET), E("1.5"));
  });

  it("holds the cap across two buys", async () => {
    const { call, chain } = await connect();
    assert.equal(((await call("derby_buy_pack", { packs: 3 })) as any).isError, undefined);
    assert.equal(((await call("derby_buy_pack", { packs: 2 })) as any).isError, true);
    assert.deepEqual(chain.calls, ["approve", "buyPacks"]);
  });

  it("refuses without a key, with short IMD, or with no ETH", async () => {
    const a = new FakeChain(); a.wallet = undefined;
    const b = new FakeChain(); b.imd = E("0.1");
    const c = new FakeChain(); c.eth = 0n;
    for (const chain of [a, b, c]) {
      const r: any = await (await connect(chain)).call("derby_buy_pack", { packs: 1 });
      assert.equal(r.isError, true);
      assert.deepEqual(chain.calls, []);
    }
  });

  it("rejects packs outside 1-10", async () => {
    const { call, chain } = await connect();
    for (const packs of [0, 11, 1.5]) assert.equal(((await call("derby_buy_pack", { packs })) as any).isError, true);
    assert.equal(((await call("derby_buy_pack", {})) as any).isError, true);
    assert.deepEqual(chain.calls, []);
  });
});

describe("derby_swing", () => {
  it("commits, waits for the target block, reveals and reports", async () => {
    const chain = new FakeChain();
    chain.turnCount = 5n;
    const r: any = await (await connect(chain)).call("derby_swing", {});
    assert.equal(r.isError, undefined);
    const s = r.structuredContent;
    assert.equal(s.swingId, "42");
    assert.equal(s.tierName, "BOMB");
    assert.equal(s.homer, true);
    assert.equal(s.feet, 450);
    assert.equal(s.todayScore, 450);
    assert.equal(s.turnsLeft, 4);
    assert.deepEqual(s.txHashes, { commit: "0xcommit", finalize: "0xfinal" });
    assert.deepEqual(chain.calls, ["swing", "finalize"]);
  });

  it("reports a non-homer", async () => {
    const chain = new FakeChain();
    chain.turnCount = 1n;
    chain.swingTier = 2;
    const r: any = await (await connect(chain)).call("derby_swing", { quality: 10, velo: 0 });
    assert.equal(r.structuredContent.tierName, "POP");
    assert.equal(r.structuredContent.homer, false);
  });

  it("names derby_buy_pack when there are no turns or no key", async () => {
    const none = new FakeChain();
    const r: any = await (await connect(none)).call("derby_swing", {});
    assert.equal(r.isError, true);
    assert.match(text(r), /derby_buy_pack/);
    const keyless = new FakeChain(); keyless.wallet = undefined;
    const k: any = await (await connect(keyless)).call("derby_swing", {});
    assert.equal(k.isError, true);
    assert.deepEqual(none.calls, []);
  });

  it("times out waiting for the target block and names the swing", async () => {
    const chain = new FakeChain();
    chain.turnCount = 1n; chain.stuck = true;
    const r: any = await (await connect(chain, new MemoryLedger(), { ...CONFIG, revealTimeoutMs: 30 })).call("derby_swing", {});
    assert.equal(r.isError, true);
    assert.match(text(r), /Swing 42/);
    assert.deepEqual(chain.calls, ["swing"]);
  });

  it("returns isError with the swingId when the reveal fails", async () => {
    const chain = new FakeChain();
    chain.turnCount = 1n; chain.revealFails = true;
    const r: any = await (await connect(chain)).call("derby_swing", {});
    assert.equal(r.isError, true);
    assert.match(text(r), /Swing 42/);
  });

  it("rejects out-of-range quality and velo", async () => {
    const chain = new FakeChain(); chain.turnCount = 1n;
    const { call } = await connect(chain);
    for (const args of [{ quality: 0 }, { quality: 101 }, { velo: -1 }, { velo: 101 }]) {
      assert.equal(((await call("derby_swing", args)) as any).isError, true);
    }
    assert.deepEqual(chain.calls, []);
  });
});

describe("derby_settle", () => {
  it("settles a closed day and returns winners, amounts and tip", async () => {
    const chain = new FakeChain();
    const r: any = await (await connect(chain)).call("derby_settle", {});
    assert.equal(r.isError, undefined);
    assert.equal(r.structuredContent.day, 19999);
    assert.deepEqual(r.structuredContent.winners, [{ player: OTHER, amountImd: "1.5" }, { player: WALLET, amountImd: "0.5" }]);
    assert.equal(r.structuredContent.tipImd, "0.01");
    assert.equal(r.structuredContent.txHash, "0xsettle");
  });

  it("explains when nothing waits", async () => {
    const chain = new FakeChain();
    chain.settlement = { exists: false, ready: false, day: 0n, amount: 0n, tip: 0n };
    const r: any = await (await connect(chain)).call("derby_settle", {});
    assert.equal(r.isError, true);
    assert.match(text(r), /Nothing to settle/);
    assert.deepEqual(chain.calls, []);
  });

  it("explains when the day is not closed", async () => {
    const chain = new FakeChain();
    chain.settlement = { exists: true, ready: false, day: 20000n, amount: 0n, tip: 0n };
    const r: any = await (await connect(chain)).call("derby_settle", { league: "arcade" });
    assert.equal(r.isError, true);
    assert.match(text(r), /not closed/);
    assert.deepEqual(chain.calls, []);
  });

  it("needs a key", async () => {
    const chain = new FakeChain(); chain.wallet = undefined;
    const r: any = await (await connect(chain)).call("derby_settle", {});
    assert.equal(r.isError, true);
  });
});
