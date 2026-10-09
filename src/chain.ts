import { AbiCoder, Contract, JsonRpcProvider, Network, Wallet, Interface, keccak256, hexlify, randomBytes } from "ethers";

export const LEAGUES = { arcade: 0, agent: 1 } as const;
export type League = keyof typeof LEAGUES;
export const TIERS = ["WHIFF", "FOUL", "POP", "HOMER", "BOMB", "SLAM"] as const;

export interface Board {
  players: string[];
  scores: bigint[];
}

export interface Settlement {
  exists: boolean;
  ready: boolean;
  day: bigint;
  amount: bigint;
  tip: bigint;
}

export interface Settled {
  txHash: string;
  day: bigint;
  winners: string[];
  amounts: bigint[];
  tip: bigint;
}

export interface Resolved {
  txHash: string;
  tier: number;
  feet: number;
}

export interface BuyReceipt {
  txHash: string;
  costWei: bigint;
}

/** A committed swing. The salt lives only inside `reveal`'s closure. */
export interface PendingSwing {
  swingId: bigint;
  committedAt: number;
  status(): Promise<number>;
  expire(): Promise<string>;
  commitTxHash: string;
  reveal(): Promise<Resolved>;
}

/** Everything the server needs from the chain; tests pass a fake. */
export interface DerbyChain {
  /** The playing wallet, or undefined when no key is configured (read-only mode). */
  readonly wallet: string | undefined;
  currentDay(): Promise<bigint>;
  packPrice(): Promise<bigint>;
  imdBalance(address: string): Promise<bigint>;
  ethBalance(address: string): Promise<bigint>;
  allowance(owner: string): Promise<bigint>;
  turns(league: League, address: string): Promise<bigint>;
  dayScore(league: League, day: bigint, address: string): Promise<bigint>;
  board(league: League, day: bigint): Promise<Board>;
  dayPot(league: League, day: bigint): Promise<bigint>;
  nextSettlement(league: League): Promise<Settlement>;
  blockNumber(): Promise<number>;
  blockTimestamp(): Promise<number>;
  /** Minimum status-poll interval for a real RPC. */
  readonly pollIntervalMs?: number;
  approve(amount: bigint): Promise<string>;
  buyPacks(league: League, packs: number): Promise<string | BuyReceipt>;
  commitSwing(league: League, quality: number, velo: number): Promise<PendingSwing>;
  settleNextDay(league: League): Promise<Settled>;
  /** Set by the real client after buyPacks confirms; fakes may provide it too. */
  readonly lastBuyCost?: bigint;
}

// ABI taken from SwarmDerby.sol (pepegobig/swarm-derby-contracts @ da1a8647d6f33b23e6838b57fc7821ef7a6b454b).
export const DERBY_ABI = [
  "function imd() view returns (address)",
  "function packPrice() view returns (uint256)",
  "function currentDay() view returns (uint256)",
  "function playerOf(address caller) view returns (address)",
  "function turns(uint8 league, address player) view returns (uint256)",
  "function dayScore(uint8 league, uint256 day, address player) view returns (uint256)",
  "function dayPot(uint8 league, uint256 day) view returns (uint256)",
  "function board(uint8 league, uint256 day) view returns (address[] players, uint256[] scores)",
  "function nextSettlement(uint8 league) view returns (bool exists, bool ready, uint256 day, uint256 amount, uint256 tip)",
  "function buyPacks(uint8 league, uint256 packs)",
  "function swing(uint8 league, uint8 quality, uint8 velo, bytes32 commit) returns (uint256)",
  "function finalize(uint256 swingId, bytes32 salt) returns (uint8 tier, uint16 feet)",
  "function expire(uint256 swingId)",
  "function swings(uint256) view returns (address player, uint8 league, uint8 quality, uint8 velo, uint8 status, uint64 committedAt, bytes32 commit, uint32 day, bytes32 drawHash)",
  "function settleNextDay(uint8 league)",
  "event SwingCommitted(uint256 indexed swingId, address indexed player, uint8 league, uint8 quality, uint8 velo, uint64 committedAt)",
  "event SwingDrawn(uint256 indexed swingId, bytes32 drawHash)",
  "event SwingRefunded(uint256 indexed swingId, address indexed player, uint8 league)",
  "event SwingResolved(uint256 indexed swingId, address indexed player, uint8 tier, uint16 feet)",
  "event DaySettled(uint8 indexed league, uint256 indexed day, address[] winners, uint256[] amounts, address settler, uint256 tip, uint256 rollover)",
  "event TurnsBought(address indexed player, uint8 indexed league, uint256 count, uint256 cost, uint256 burned)",
  "error NotOwner()",
  "error BadLeague()",
  "error BadPrice()",
  "error NoTurns()",
  "error DailyCapReached()",
  "error BadQuality()",
  "error BadCommit()",
  "error BadSalt()",
  "error WrongStatus()",
  "error DrawClosed()",
  "error BadDraw()",
  "error BadKey()",
  "error CommitUsed()",
  "error NoHouseKey()",
  "error KeyNotReady()",
  "error KeyExpired()",
  "error NotExpired()",
  "error BadSession()",
  "error TransferFailed()",
  "error NothingToSettle()",
  "error DayNotOver()",
  "error ZeroAddress()",
  "error NotAContract()",
  "error ZeroCount()",
];

/** Decode only events emitted by the configured game contract. */
export function parseDerbyEvent(
  logs: readonly { address: string; topics: readonly string[]; data: string }[],
  name: string,
  contract: string,
  iface = new Interface(DERBY_ABI),
) {
  for (const log of logs) {
    if (log.address.toLowerCase() !== contract.toLowerCase()) continue;
    try {
      const ev = iface.parseLog(log);
      if (ev?.name === name) return ev;
    } catch { /* unrelated event */ }
  }
  return null;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function allowance(address, address) view returns (uint256)",
  "function approve(address, uint256) returns (bool)",
];

const CUSTOM_ERRORS: Record<string, string> = {
  NotOwner: "Only the contract owner can do that.",
  BadLeague: "That league does not exist.",
  BadPrice: "The pack price is invalid.",
  NoTurns: "You have no turns left in this league; buy a pack with derby_buy_pack.",
  DailyCapReached: "The daily swing cap for this league has been reached.",
  BadQuality: "Quality and velo must be between 0 and 100.",
  BadCommit: "The swing commit was empty.",
  BadSalt: "The revealed salt does not match the commit.",
  WrongStatus: "That swing is not in the required state for this action.",
  DrawClosed: "The house draw window has closed.",
  BadDraw: "The house draw signature is invalid.",
  BadKey: "The house key is invalid.",
  CommitUsed: "That swing commit has already been used; use a fresh salt.",
  NoHouseKey: "The house draw is paused (no house key). Nothing was spent; try again later.",
  KeyNotReady: "The proposed house key is not ready to activate yet.",
  KeyExpired: "The proposed house key has expired.",
  NotExpired: "That swing is still within its draw or reveal window, so it cannot be expired yet.",
  BadSession: "The session key is not valid for this player.",
  TransferFailed: "An IMD or ETH transfer failed.",
  NothingToSettle: "There is no unsettled day waiting in this league.",
  DayNotOver: "The oldest unsettled day is not closed yet: it must be over (UTC) and every swing of it revealed or expired.",
  ZeroAddress: "A zero address was given.",
  NotAContract: "The target address is not a contract.",
  ZeroCount: "The count must be greater than zero.",
};

/** Turn any thrown value (ethers errors, custom-error reverts, RPC failures) into a plain sentence. */
export function explainError(err: unknown, iface?: Contract["interface"]): string {
  const e = err as {
    code?: string;
    data?: string;
    shortMessage?: string;
    message?: string;
    revert?: { name?: string };
    info?: { error?: { data?: string; message?: string } };
    error?: { data?: string; message?: string };
  };
  let name = e?.revert?.name;
  if (!name && iface) {
    for (const data of [e?.data, e?.info?.error?.data, e?.error?.data]) {
      if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) {
        try {
          name = iface.parseError(data)?.name;
        } catch {
          /* not one of ours */
        }
        if (name) break;
      }
    }
  }
  if (name && CUSTOM_ERRORS[name]) return CUSTOM_ERRORS[name];
  if (e?.code === "INSUFFICIENT_FUNDS") return "The wallet has too little ETH to pay for gas.";
  if (e?.code === "NETWORK_ERROR" || e?.code === "SERVER_ERROR" || e?.code === "TIMEOUT") {
    return "The Robinhood Chain RPC could not be reached; try again shortly.";
  }
  const text = (e?.shortMessage ?? e?.message ?? String(err)).split("\n")[0];
  return text.length > 300 ? `${text.slice(0, 300)}…` : text;
}

export interface ChainOptions {
  rpcUrl: string;
  contract: string;
  privateKey?: string;
  txTimeoutMs?: number;
}

export function createChain(opts: ChainOptions): DerbyChain {
  // No read cache: on ~100ms blocks the default cache can return a stale nonce after a tx.
  const provider = new JsonRpcProvider(opts.rpcUrl, Network.from(4663), { cacheTimeout: -1, staticNetwork: true });
  provider.pollingInterval = 1000;
  let signer: Wallet | undefined;
  if (opts.privateKey) {
    try {
      signer = new Wallet(opts.privateKey, provider);
    } catch {
      // Never echo the underlying error: it could quote the key.
      throw new Error("DERBY_PRIVATE_KEY is not a valid private key.");
    }
  }
  const derby = new Contract(opts.contract, DERBY_ABI, signer ?? provider);
  let imdToken: Contract | undefined;
  const imd = async () =>
    (imdToken ??= new Contract(await derby.getFunction("imd")(), ERC20_ABI, signer ?? provider));
  const need = () => {
    if (!signer) throw new Error("No DERBY_PRIVATE_KEY is configured.");
    return signer;
  };
  const wrap = async <T>(p: () => Promise<T>): Promise<T> => {
    try {
      return await p();
    } catch (err) {
      const e = new Error(explainError(err, derby.interface)) as Error & {
        reportedRevert?: boolean;
        transactionHash?: string;
      };
      const source = err as { reportedRevert?: boolean; transactionHash?: string };
      e.reportedRevert = source.reportedRevert;
      e.transactionHash = source.transactionHash;
      throw e;
    }
  };
  const send = async (txPromise: Promise<any>) => {
    let tx: any;
    try {
      tx = await txPromise;
    } catch (err) {
      // Estimation/broadcast may also report a revert; the server still verifies state.
      if ((err as { code?: string }).code === "CALL_EXCEPTION") {
        (err as { reportedRevert?: boolean }).reportedRevert = true;
      }
      throw err;
    }
    let rc: any;
    try {
      rc = await tx.wait(1, opts.txTimeoutMs ?? 60000);
    } catch (err) {
      const source = err as { code?: string; receipt?: { status?: number } };
      if (source.code === "CALL_EXCEPTION" && source.receipt?.status === 0) {
        const e = new Error(`Transaction ${tx.hash} reverted.`);
        (e as Error & { reportedRevert?: boolean }).reportedRevert = true;
        throw e;
      }
      const e = new Error(`${explainError(err)} (transaction ${tx.hash} was broadcast but not confirmed).`);
      (e as Error & { transactionHash?: string }).transactionHash = tx.hash;
      throw e;
    }
    if (!rc || rc.status !== 1) {
      const e = new Error(`Transaction ${tx.hash} reverted.`);
      (e as Error & { reportedRevert?: boolean }).reportedRevert = true;
      throw e;
    }
    return rc;
  };
  const event = (rc: any, name: string) => {
    const ev = parseDerbyEvent(rc.logs, name, opts.contract, derby.interface);
    if (ev) return ev;
    throw new Error(`Transaction ${rc.hash} did not emit ${name}.`);
  };

  let lastBuyCost: bigint | undefined;
  return {
    wallet: signer?.address,
    pollIntervalMs: 1000,
    get lastBuyCost() { return lastBuyCost; },
    currentDay: () => wrap(async () => BigInt(await derby.currentDay())),
    packPrice: () => wrap(async () => BigInt(await derby.packPrice())),
    imdBalance: (a) => wrap(async () => BigInt(await (await imd()).balanceOf(a))),
    ethBalance: (a) => wrap(async () => provider.getBalance(a)),
    allowance: (o) => wrap(async () => BigInt(await (await imd()).allowance(o, opts.contract))),
    turns: (l, a) => wrap(async () => BigInt(await derby.turns(LEAGUES[l], a))),
    dayScore: (l, d, a) => wrap(async () => BigInt(await derby.dayScore(LEAGUES[l], d, a))),
    board: (l, d) =>
      wrap(async () => {
        const [players, scores] = await derby.board(LEAGUES[l], d);
        return { players: [...players], scores: [...scores].map(BigInt) };
      }),
    dayPot: (l, d) => wrap(async () => BigInt(await derby.dayPot(LEAGUES[l], d))),
    nextSettlement: (l) =>
      wrap(async () => {
        const r = await derby.nextSettlement(LEAGUES[l]);
        return { exists: r[0], ready: r[1], day: BigInt(r[2]), amount: BigInt(r[3]), tip: BigInt(r[4]) };
      }),
    blockNumber: () => wrap(async () => Number(await provider.send("eth_blockNumber", []))),
    blockTimestamp: () => wrap(async () => {
      const block = await provider.getBlock("latest");
      if (!block) throw new Error("The latest block is unavailable.");
      return block.timestamp;
    }),
    approve: (amount) =>
      wrap(async () => {
        const rc = await send((await imd()).approve(opts.contract, amount));
        return rc.hash as string;
      }),
    buyPacks: (l, packs) =>
      wrap(async () => {
        need();
        lastBuyCost = undefined;
        const rc = await send(derby.buyPacks(LEAGUES[l], packs));
        const bought = event(rc, "TurnsBought");
        lastBuyCost = BigInt(bought.args.cost);
        return { txHash: rc.hash as string, costWei: lastBuyCost! };
      }),
    commitSwing: (l, quality, velo) =>
      wrap(async () => {
        const me = need().address;
        // Fresh secret per swing; only its hash goes on-chain. It never leaves this closure.
        const salt = hexlify(randomBytes(32));
        const player = await derby.playerOf(me);
        const commit = keccak256(AbiCoder.defaultAbiCoder().encode(["bytes32", "address"], [salt, player]));
        const rc = await send(derby.swing(LEAGUES[l], quality, velo, commit));
        const committed = event(rc, "SwingCommitted");
        const swingId = BigInt(committed.args.swingId);
        return {
          swingId,
          committedAt: Number(committed.args.committedAt),
          status: () => wrap(async () => Number((await derby.swings(swingId)).status)),
          expire: () => wrap(async () => {
            const expired = await send(derby.expire(swingId));
            event(expired, "SwingRefunded");
            return expired.hash as string;
          }),
          commitTxHash: rc.hash as string,
          reveal: () =>
            wrap(async () => {
              const fin = await send(derby.finalize(swingId, salt));
              const resolved = event(fin, "SwingResolved");
              return { txHash: fin.hash as string, tier: Number(resolved.args.tier), feet: Number(resolved.args.feet) };
            }),
        };
      }),
    settleNextDay: (l) =>
      wrap(async () => {
        need();
        const rc = await send(derby.settleNextDay(LEAGUES[l]));
        const ev = event(rc, "DaySettled");
        return {
          txHash: rc.hash as string,
          day: BigInt(ev.args.day),
          winners: [...ev.args.winners] as string[],
          amounts: [...ev.args.amounts].map(BigInt),
          tip: BigInt(ev.args.tip),
        };
      }),
  };
}
