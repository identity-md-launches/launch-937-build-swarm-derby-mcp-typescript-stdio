import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { formatEther } from "ethers";
import { z } from "zod";
import { TIERS, type DerbyChain, type League, type PendingSwing } from "./chain.js";
import type { Config } from "./config.js";
import type { Ledger } from "./ledger.js";

export const SERVER_NAME = "swarm-derby-mcp";
export const SERVER_VERSION = "0.1.0";

export interface Deps {
  chain: DerbyChain;
  ledger: Ledger;
  config: Config;
}

type Result = {
  content: { type: "text"; text: string }[];
  structuredContent?: Record<string, unknown>;
  isError?: true;
};

const fail = (text: string): Result => ({ content: [{ type: "text", text }], isError: true });
const ok = (data: Record<string, unknown>): Result => ({
  content: [{ type: "text", text: JSON.stringify(data) }],
  structuredContent: data,
});
const imd = (wei: bigint) => formatEther(wei);
const message = (err: unknown) => (err instanceof Error ? err.message : String(err));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const leagueSchema = z.enum(["agent", "arcade"]);
const capSchema = z.object({ maxImd: z.string(), spentImd: z.string(), remainingImd: z.string() });

export function createServer({ chain, ledger, config }: Deps): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  // Write tools run one at a time so two calls cannot both pass the cap check.
  let queue: Promise<unknown> = Promise.resolve();
  const exclusive = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = queue.then(fn, fn);
    queue = run.catch(() => undefined);
    return run;
  };

  const pendingSwings = new Map<bigint, PendingSwing>();

  const cap = (wallet: string | undefined) => {
    const spent = wallet ? ledger.spent(wallet) : 0n;
    const remaining = config.maxImdWei > spent ? config.maxImdWei - spent : 0n;
    return { maxImd: imd(config.maxImdWei), spentImd: imd(spent), remainingImd: imd(remaining) };
  };

  const noKey = (tool: string) =>
    fail(`${tool} needs a wallet: set DERBY_PRIVATE_KEY in the server's environment. Without it the server is read-only.`);

  const agentScore = async (wallet: string, day: bigint) => {
    const [score, board] = await Promise.all([chain.dayScore("agent", day, wallet), chain.board("agent", day)]);
    const idx = board.players.findIndex((p) => p.toLowerCase() === wallet.toLowerCase());
    return { score: Number(score), rank: idx >= 0 ? idx + 1 : null };
  };

  server.registerTool(
    "derby_status",
    {
      title: "Derby status",
      description:
        "Show the Swarm Derby agent-league state: mode (read-only without a key, else play), wallet, UTC day, pack price, IMD and ETH balances, agent turns, today's score and rank, and the spending cap.",
      inputSchema: {},
      outputSchema: {
        mode: z.enum(["read-only", "play"]),
        wallet: z.string().nullable(),
        day: z.number(),
        packPrice: z.string().describe("IMD per pack of 5 turns."),
        imdBalance: z.string().nullable(),
        ethBalance: z.string().nullable(),
        agentTurns: z.number().nullable(),
        todayScore: z.number().nullable().describe("Total homer feet today in the agent league."),
        todayRank: z.number().nullable().describe("Place on today's top-10 board, null when not on it."),
        cap: capSchema,
      },
      annotations: { readOnlyHint: true },
    },
    async () => {
      try {
        const wallet = chain.wallet;
        const [day, packPrice] = await Promise.all([chain.currentDay(), chain.packPrice()]);
        let player: Record<string, unknown> = {
          imdBalance: null,
          ethBalance: null,
          agentTurns: null,
          todayScore: null,
          todayRank: null,
        };
        if (wallet) {
          const [imdBal, ethBal, turns, today] = await Promise.all([
            chain.imdBalance(wallet),
            chain.ethBalance(wallet),
            chain.turns("agent", wallet),
            agentScore(wallet, day),
          ]);
          player = {
            imdBalance: imd(imdBal),
            ethBalance: formatEther(ethBal),
            agentTurns: Number(turns),
            todayScore: today.score,
            todayRank: today.rank,
          };
        }
        return ok({
          mode: wallet ? "play" : "read-only",
          wallet: wallet ?? null,
          day: Number(day),
          packPrice: imd(packPrice),
          ...player,
          cap: cap(wallet),
        });
      } catch (err) {
        return fail(message(err));
      }
    },
  );

  server.registerTool(
    "derby_board",
    {
      title: "Derby board",
      description:
        "Show a league's top-10 board for a UTC day (default today), with the day's pot and the next settlement waiting to be paid. Agent scores are total homer feet.",
      inputSchema: {
        league: leagueSchema.optional().default("agent").describe("League: agent (default) or arcade."),
        day: z
          .number()
          .int()
          .min(0)
          .optional()
          .describe("UTC day number (unix seconds / 86400). Defaults to today; future days are refused."),
      },
      outputSchema: {
        league: leagueSchema,
        day: z.number(),
        rows: z.array(z.object({ rank: z.number(), player: z.string(), feet: z.number() })),
        dayPot: z.string().describe("IMD in that day's pot."),
        nextSettlement: z.object({
          exists: z.boolean(),
          ready: z.boolean(),
          day: z.number().nullable(),
          amountImd: z.string(),
          tipImd: z.string(),
        }),
      },
      annotations: { readOnlyHint: true },
    },
    async ({ league, day }) => {
      try {
        const today = await chain.currentDay();
        const wanted = day === undefined ? today : BigInt(day);
        if (wanted > today) return fail(`Day ${wanted} is in the future; today is day ${today} (UTC).`);
        const [board, pot, next] = await Promise.all([
          chain.board(league as League, wanted),
          chain.dayPot(league as League, wanted),
          chain.nextSettlement(league as League),
        ]);
        return ok({
          league,
          day: Number(wanted),
          rows: board.players.map((player, i) => ({ rank: i + 1, player, feet: Number(board.scores[i]) })),
          dayPot: imd(pot),
          nextSettlement: {
            exists: next.exists,
            ready: next.ready,
            day: next.exists ? Number(next.day) : null,
            amountImd: imd(next.amount),
            tipImd: imd(next.tip),
          },
        });
      } catch (err) {
        return fail(message(err));
      }
    },
  );

  server.registerTool(
    "derby_buy_pack",
    {
      title: "Buy turn packs",
      description:
        "Spend IMD on packs of 5 agent-league turns (packs × the on-chain pack price). Refused before any signature if it would pass the DERBY_MAX_IMD cap, IMD is short, or the wallet has no ETH for gas. Approves only the exact cost.",
      inputSchema: {
        packs: z.number().int().min(1).max(10).describe("Number of 5-turn packs to buy, 1-10."),
      },
      outputSchema: {
        txHashes: z.array(z.string()).describe("Approve then buy."),
        packs: z.number(),
        costImd: z.string(),
        turnsAdded: z.number(),
        agentTurns: z.number(),
        cap: capSchema,
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ packs }) => {
      const run = async () => {
        try {
          const wallet = chain.wallet;
          if (!wallet) return noKey("derby_buy_pack");
          const cost = (await chain.packPrice()) * BigInt(packs);
          const spent = ledger.spent(wallet);
          if (spent + cost > config.maxImdWei) {
            return fail(
              `Refused: buying ${packs} pack(s) costs ${imd(cost)} IMD, which would take spending to ${imd(spent + cost)} IMD, past the DERBY_MAX_IMD cap of ${imd(config.maxImdWei)} IMD (${imd(spent)} already spent). Nothing was signed.`,
            );
          }
          const balance = await chain.imdBalance(wallet);
          if (balance < cost) {
            return fail(`Refused: ${packs} pack(s) cost ${imd(cost)} IMD but the wallet holds ${imd(balance)} IMD. Nothing was signed.`);
          }
          if ((await chain.ethBalance(wallet)) === 0n) {
            return fail(`Refused: the wallet ${wallet} has no ETH for gas. Nothing was signed.`);
          }
          const txHashes: string[] = [];
          const reserved = ledger.reserve
            ? ledger.reserve(wallet, cost, config.maxImdWei)
            : (() => { if (spent + cost > config.maxImdWei) return false; ledger.add(wallet, cost); return true; })();
          if (!reserved) {
            return fail(`Refused: buying ${packs} pack(s) would pass the DERBY_MAX_IMD cap of ${imd(config.maxImdWei)} IMD. Nothing was signed.`);
          }
          let beforeBuy: { turns: bigint; balance: bigint } | undefined;
          try {
            txHashes.push(await chain.approve(cost));
            // Snapshot immediately before the buy, then independently check any reported revert.
            const before = await Promise.all([chain.turns("agent", wallet), chain.imdBalance(wallet)]);
            beforeBuy = { turns: before[0], balance: before[1] };
            const bought = await chain.buyPacks("agent", packs);
            const buyHash = typeof bought === "string" ? bought : bought.txHash;
            txHashes.push(buyHash);
            const receiptCost = typeof bought === "string" ? undefined : bought.costWei;
            const actualCost = receiptCost ?? chain.lastBuyCost ?? cost;
            if (actualCost !== cost) {
              if (ledger.adjust) ledger.adjust(wallet, actualCost - cost);
              else ledger.add(wallet, actualCost - cost);
            }
            if (actualCost > cost) {
              return fail(`The buy cost ${imd(actualCost)} IMD was above the quoted price of ${imd(cost)} IMD (tx ${buyHash}). The charged amount was kept in the spending ledger.`);
            }
            return ok({
              txHashes,
              packs,
              costImd: imd(actualCost),
              turnsAdded: packs * 5,
              agentTurns: Number(await chain.turns("agent", wallet)),
              cap: cap(wallet),
            });
          } catch (err) {
            const e = err as Error & { reportedRevert?: boolean; confirmedNoCharge?: boolean };
            // A receipt or RPC assertion alone cannot prove that nothing was spent.
            if ((e.reportedRevert || e.confirmedNoCharge) && beforeBuy) {
              try {
                const [turns, balance] = await Promise.all([chain.turns("agent", wallet), chain.imdBalance(wallet)]);
                if (turns <= beforeBuy.turns && balance >= beforeBuy.balance) {
                  if (ledger.adjust) ledger.adjust(wallet, -cost);
                  else ledger.add(wallet, -cost);
                }
              } catch { /* failed verification keeps the reservation */ }
            }
            throw err;
          }
        } catch (err) {
          return fail(message(err));
        }
      };
      return exclusive(() => ledger.withSpendLock ? ledger.withSpendLock(run) : run());
    },
  );

  server.registerTool(
    "derby_swing",
    {
      title: "Take a swing",
      description:
        "Spend one agent-league turn: commit a swing, wait for the house draw, then reveal it. A timed-out commit is kept: the next call reveals it if drawn or refunds it after 5 minutes; revealing after 10 minutes counts as a foul. Tiers: WHIFF, FOUL, POP, HOMER, BOMB, SLAM; HOMER and above score feet. Needs a key and a turn (buy with derby_buy_pack).",
      inputSchema: {
        quality: z.number().int().min(1).max(100).optional().default(100).describe("Swing quality 1-100; higher is never worse. Default 100."),
        velo: z.number().int().min(0).max(100).optional().default(100).describe("Exit-velo score 0-100; low values rule out bombs and slams. Default 100."),
      },
      outputSchema: {
        earlier: z.array(z.union([z.string(), z.record(z.string(), z.unknown())])).optional(),
        note: z.string().optional(),
        swingId: z.string(),
        tier: z.number(),
        tierName: z.enum(TIERS),
        feet: z.number(),
        homer: z.boolean().describe("True for tier 3 (HOMER) and above."),
        todayScore: z.number(),
        turnsLeft: z.number(),
        txHashes: z.object({ commit: z.string(), finalize: z.string() }),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ quality, velo }) =>
      exclusive(async () => {
        const earlier: (string | Record<string, unknown>)[] = [];
        const swingFail = (text: string): Result => earlier.length
          ? { ...fail(`${text} Earlier: ${JSON.stringify(earlier)}`), structuredContent: { earlier } }
          : fail(text);
        try {
          const wallet = chain.wallet;
          if (!wallet) return noKey("derby_swing");
          const reveal = async (pending: PendingSwing) => {
            const late = (await chain.blockTimestamp()) > pending.committedAt + 600;
            const resolved = await pending.reveal();
            pendingSwings.delete(pending.swingId);
            const today = await agentScore(wallet, await chain.currentDay());
            return {
              swingId: pending.swingId.toString(),
              tier: resolved.tier,
              tierName: TIERS[resolved.tier] ?? "WHIFF",
              feet: resolved.feet,
              homer: resolved.tier >= 3,
              todayScore: today.score,
              turnsLeft: Number(await chain.turns("agent", wallet)),
              txHashes: { commit: pending.commitTxHash, finalize: resolved.txHash },
              ...(late ? { note: `Swing ${pending.swingId} was revealed after 10 minutes and counted as a foul.` } : {}),
            };
          };
          for (const pending of pendingSwings.values()) {
            const status = await pending.status();
            if (status === 2) earlier.push(await reveal(pending));
            else if (status === 1 && (await chain.blockTimestamp()) > pending.committedAt + 300) {
              const hash = await pending.expire();
              pendingSwings.delete(pending.swingId);
              earlier.push(`The house did not draw swing ${pending.swingId} within 5 minutes. The turn was given back (tx ${hash}).`);
            } else if (status === 3 || status === 4) pendingSwings.delete(pending.swingId);
          }
          if ((await chain.turns("agent", wallet)) === 0n) {
            const recovered = [...earlier].reverse().find((item) => typeof item !== "string");
            if (recovered) return ok({ ...recovered as Record<string, unknown>, earlier });
            return swingFail("No agent turns left. Call derby_buy_pack to buy a pack of 5 turns first.");
          }
          if ((await chain.ethBalance(wallet)) === 0n) {
            return swingFail(`The wallet ${wallet} has no ETH for gas, so it cannot swing.`);
          }
          const pending = await chain.commitSwing("agent", quality, velo);
          pendingSwings.set(pending.swingId, pending);
          const deadline = Date.now() + config.drawTimeoutMs;
          for (;;) {
            const status = await pending.status();
            if (status === 2) {
              try {
                return ok({ ...await reveal(pending), ...(earlier.length ? { earlier } : {}) });
              } catch (err) {
                if (Date.now() >= deadline || (err as { transactionHash?: string }).transactionHash) {
                  return swingFail(`Swing ${pending.swingId} is committed but the reveal failed: ${message(err)}`);
                }
                await sleep(Math.max(config.pollIntervalMs, chain.pollIntervalMs ?? 0));
                continue;
              }
            }
            if (status === 3 || status === 4) {
              pendingSwings.delete(pending.swingId);
              return swingFail(`Swing ${pending.swingId} was already finalized or refunded.`);
            }
            if (Date.now() >= deadline) {
              return swingFail(`Swing ${pending.swingId} is committed but not drawn yet. The next derby_swing call reveals it if the house draws it, or gives the turn back 5 minutes after the commit.`);
            }
            await sleep(Math.max(config.pollIntervalMs, chain.pollIntervalMs ?? 0));
          }
        } catch (err) {
          return swingFail(message(err));
        }
      }),
  );

  server.registerTool(
    "derby_settle",
    {
      title: "Settle a day",
      description:
        "Settle the league's oldest unsettled day (pays the top 3 and tips the caller). Needs a key and gas only. Refused when nothing waits or the day is not closed yet.",
      inputSchema: {
        league: leagueSchema.optional().default("agent").describe("League to settle: agent (default) or arcade."),
      },
      outputSchema: {
        league: leagueSchema,
        day: z.number(),
        winners: z.array(z.object({ player: z.string(), amountImd: z.string() })),
        tipImd: z.string(),
        txHash: z.string(),
      },
      annotations: { destructiveHint: true, openWorldHint: true },
    },
    ({ league }) =>
      exclusive(async () => {
        try {
          const wallet = chain.wallet;
          if (!wallet) return noKey("derby_settle");
          const next = await chain.nextSettlement(league as League);
          if (!next.exists) return fail(`Nothing to settle: every ${league} day with activity is already settled.`);
          if (!next.ready) {
            return fail(
              `Day ${next.day} of the ${league} league is not closed yet: a day closes once it is over (UTC) and every swing of it has been revealed or its 10-minute draw and reveal window has passed.`,
            );
          }
          if ((await chain.ethBalance(wallet)) === 0n) {
            return fail(`The wallet ${wallet} has no ETH for gas, so it cannot settle.`);
          }
          const done = await chain.settleNextDay(league as League);
          return ok({
            league,
            day: Number(done.day),
            winners: done.winners.map((player, i) => ({ player, amountImd: imd(done.amounts[i]) })),
            tipImd: imd(done.tip),
            txHash: done.txHash,
          });
        } catch (err) {
          return fail(message(err));
        }
      }),
  );

  return server;
}
