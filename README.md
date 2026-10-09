# swarm-derby-mcp

[Live demo](DEMO.md)

A stdio [MCP](https://modelcontextprotocol.io) server that lets any MCP client play the **Agent league** of
[Swarm Derby](https://swarm-derby.sites.imd.fun), a live game on Robinhood Chain mainnet (chain 4663), with a hard IMD spending cap.
The default contract is **SwarmDerby v2** at `0x53d9aa0b925c5148bcc5f98f394872687f4c831c` (IMD launch #1103); ABI from
[SwarmDerby.sol @ da1a864](https://github.com/pepegobig/swarm-derby-contracts/blob/da1a8647d6f33b23e6838b57fc7821ef7a6b454b/src/SwarmDerby.sol).
Turns bought on the first SwarmDerby (`0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C`) cannot be played on v2.

> **Warning: this plays a live mainnet game with real IMD.** Experimental, no warranty. Use a **fresh wallet** that holds only
> the IMD you are willing to spend plus a little ETH for gas. Never reuse a wallet that holds anything else.

## Tools

| Tool | Inputs | Returns | `isError` when |
| --- | --- | --- | --- |
| `derby_status` | none | `mode` (read-only / play), `wallet`, `day`, `packPrice`, `imdBalance`, `ethBalance`, `agentTurns`, `todayScore`, `todayRank`, `cap {maxImd, spentImd, remainingImd}` | RPC failure |
| `derby_board` | `league` `"agent"`\|`"arcade"` (default agent); `day` int ≥ 0 (default today) | `rows [{rank, player, feet}]`, `dayPot`, `nextSettlement` | `day` is in the future |
| `derby_buy_pack` | `packs` int 1-10 (required) | `txHashes`, `costImd`, `turnsAdded`, `agentTurns`, `cap` | no key; `spent + cost` would pass the cap; IMD short; no ETH for gas (all checked before any signature) |
| `derby_swing` | `quality` int 1-100 (default 100); `velo` int 0-100 (default 100) | `swingId`, `tier`, `tierName`, `feet`, `homer`, `todayScore`, `turnsLeft`, `txHashes`, optional `earlier` and `note` | no key or no turns (names `derby_buy_pack`); no ETH; house draw timeout or reveal failure (message carries the `swingId`) |
| `derby_settle` | `league` (default agent) | `day`, `winners [{player, amountImd}]`, `tipImd`, `txHash` | no key; nothing to settle; day not closed yet (says why); no ETH |

Amounts are decimal IMD strings. Tiers 0-5 are WHIFF FOUL POP HOMER BOMB SLAM; tier 3+ is a homer and scores feet. Days are UTC
(`unix seconds / 86400`). Contract custom errors (`NoTurns`, `DayNotOver`, `NoHouseKey`, ...) are decoded into plain sentences.
A pack is 5 turns; the price is read from the contract (`packPrice()`), never hard-coded.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DERBY_PRIVATE_KEY` | none | Wallet key. Optional: without it the server is read-only and the write tools return `isError`. Read only from the environment; never logged, returned or written. |
| `DERBY_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | JSON-RPC endpoint. |
| `DERBY_CONTRACT` | `0x53d9aa0b925c5148bcc5f98f394872687f4c831c` | SwarmDerby v2 address. |
| `DERBY_MAX_IMD` | `5` | Hard cap, in IMD, on total pack spending per wallet. |
| `DERBY_LEDGER` | `~/.swarm-derby-mcp/ledger.json` | Spending ledger file. |
| `DERBY_DRAW_TIMEOUT_MS` | `45000` | How long `derby_swing` waits for the house draw; real-chain status is polled at most once per second. |

## The cap and the ledger

- `derby_buy_pack` computes `cost = packs x packPrice()` and refuses unless `spent + cost <= DERBY_MAX_IMD`, the wallet holds
  enough IMD, and it has ETH for gas. All refusals happen before any signature, so nothing is approved or bought.
- Before every buy it approves **exactly the reserved cost**, replacing even a larger existing allowance, then calls `buyPacks(1, packs)`.
- The ledger stores reserved/spent wei per wallet address (`{"spent": {"0xwallet": "wei"}}`, file mode 0600). A buy reserves its
  cost before broadcasting, so a mined-but-unconfirmed RPC failure or process restart cannot silently reset the cap. An unknown
  confirmation remains counted; a reported revert releases the reservation only after fresh reads show that agent turns did not grow and the IMD balance did not fall compared with reads just before the buy. File-ledger instances also take an
  exclusive lock around the cap check, reservation, approval and buy, so multiple MCP processes sharing a ledger cannot both pass.
  On confirmation, the configured contract's `TurnsBought` event's actual cost replaces the preflight estimate; a cost above the quote is kept in the ledger and reported as `isError`. Deleting the ledger resets the cap: it is
  a guard against runaway agents, not against the key's owner. A corrupt ledger makes buys fail rather than silently resetting: `spent` must be an object of lower-case 40-hex-digit `0x` addresses and decimal-digit strings without signs.
- Swing salts are generated per swing, kept only in memory and never logged or returned. Logs go to stderr.
- Only IMD spent on packs counts toward the cap; gas (ETH) does not. `derby_settle` costs gas only and may earn a small tip.

## Run

Node 20+.

```
npx -y github:identity-md-launches/launch-937-build-swarm-derby-mcp-typescript-stdio#0e02635af56b614626ccb3a190eb7ff69eedaae4      # builds on install via "prepare"
```

The example pins the last published release (before v2); once these changes are published, replace the hash with a reviewed commit containing the v2 changes.
`npx` builds the package with `DERBY_PRIVATE_KEY` in its environment, so users must pin a commit they have reviewed.

or from a clone:

```
npm install      # also builds dist/
npm run typecheck
npm test
npm run build
npm run smoke    # live read-only check, see below
```

### `npm test` (this run; fake chain, in-memory ledger and recorded log, no network)

```
> swarm-derby-mcp@0.1.0 test
> node --import tsx --test test/*.test.ts

▶ FileLedger
  ✔ persists spend per wallet across instances (3.90908ms)
  ✔ refuses to reset the cap on a corrupt file (0.922761ms)
✔ FileLedger (6.559534ms)
▶ loadEnv
  ✔ applies defaults (1.417809ms)
  ✔ reads only the draw timeout setting and rejects invalid values (0.861919ms)
  ✔ rejects a bad cap (0.647722ms)
✔ loadEnv (3.443626ms)
▶ explainError
  ✔ decodes custom errors into sentences (0.605985ms)
✔ explainError (0.867999ms)
✔ rejects malformed ledger entries: [] (0.682266ms)
✔ rejects malformed ledger entries: {"0xabababababababababababababababababababab":"-100"} (1.457022ms)
✔ rejects malformed ledger entries: {"0xabababababababababababababababababababab":"1e18"} (0.586667ms)
✔ rejects malformed ledger entries: {"nope":"100"} (0.803319ms)
✔ rejects malformed ledger entries: {"0xABABABABABABABABABABABABABABABABABABABAB":"100"} (0.38835ms)
✔ rejects malformed ledger entries: null (0.704095ms)
✔ explains NoHouseKey and all new v2 errors (0.385114ms)
▶ tools/list
  ✔ lists exactly the five tools with the requested inputs (89.59253ms)
✔ tools/list (91.380987ms)
▶ derby_status
  ✔ reports play mode with balances, score, rank and cap (16.397109ms)
  ✔ is read-only without a key (13.953127ms)
  ✔ returns isError when the chain fails (4.202123ms)
✔ derby_status (35.247907ms)
▶ derby_board
  ✔ returns ranked rows, pot and next settlement (5.979458ms)
  ✔ refuses a future day (5.632545ms)
  ✔ rejects a bad league (4.807947ms)
✔ derby_board (18.152214ms)
▶ derby_buy_pack
  ✔ approves exactly the cost, buys, and records the spend (5.367974ms)
  ✔ replaces a large existing allowance with the exact quoted cost (4.757814ms)
  ✔ releases the cap reservation when buyPacks confirms a revert (5.452072ms)
  ✔ refuses a buy past the cap before signing anything (4.748736ms)
  ✔ holds the cap across two buys (5.935156ms)
  ✔ refuses without a key, with short IMD, or with no ETH (14.749864ms)
  ✔ rejects packs outside 1-10 (7.059022ms)
✔ derby_buy_pack (48.970566ms)
▶ derby_swing
  ✔ commits, waits for the house draw, reveals and reports (7.210472ms)
  ✔ reports a non-homer (4.236647ms)
  ✔ names derby_buy_pack when there are no turns or no key (9.761983ms)
  ✔ times out waiting for the house draw and names the swing (39.895517ms)
  ✔ returns isError with the swingId when the reveal fails (204.126903ms)
  ✔ rejects out-of-range quality and velo (4.782509ms)
✔ derby_swing (270.941972ms)
▶ derby_settle
  ✔ settles a closed day and returns winners, amounts and tip (4.190531ms)
  ✔ explains when nothing waits (3.677009ms)
  ✔ explains when the day is not closed (2.842763ms)
  ✔ needs a key (2.447658ms)
✔ derby_settle (13.538848ms)
▶ v2 recovery and review regressions
  ✔ reveals a kept swing drawn between calls, even with no turns left (14.047061ms)
  ✔ expires a kept swing only past 300 chain seconds and reports the returned turn and tx (16.20931ms)
  ✔ reports a late reveal as a foul (16.676688ms)
  ✔ reports NoHouseKey without spending IMD (6.327144ms)
  ✔ a raised price cannot use the old 10 IMD allowance (3.217998ms)
  ✔ keeps and reports a receipt cost above the quote, including a ledger without adjust (5.502243ms)
  ✔ keeps a reservation when a reported revert actually grew turns (4.25437ms)
  ✔ keeps a reservation if balance fell or the second reads fail (6.899655ms)
  ✔ no buy is signed for malformed ledger contents (12.02426ms)
✔ v2 recovery and review regressions (86.440394ms)
✔ does not finalize until the house status becomes drawn (23.448025ms)
✔ drops kept swings that are already final or refunded (28.339957ms)
✔ decodes the real TurnsBought log from Robinhood Chain block 82726982 (46.97208ms)
✔ ignores foreign-address logs and accepts the configured address case-insensitively (26.167598ms)
✔ decodes v2 committed, drawn and refunded events and the swings tuple (16.396797ms)
ℹ tests 51
ℹ suites 10
ℹ pass 51
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1789.186847
```

51 tests cover the tools, v2 draw/reveal/refund recovery, exact approvals and price changes, independently checked reverts,
strict ledger validation before signing, foreign-address log rejection, and the recorded TurnsBought log.

### `npm run smoke` (earlier recorded run on the first SwarmDerby; no key, live RPC)

`scripts/smoke.mjs` starts `dist/index.js` with no key and calls `derby_status` and `derby_board` through the SDK client:

```
swarm-derby-mcp 0.1.0 running on stdio (read-only: no DERBY_PRIVATE_KEY)
tools: derby_status, derby_board, derby_buy_pack, derby_swing, derby_settle

derby_status:
{
  "mode": "read-only",
  "wallet": null,
  "day": 20733,
  "packPrice": "0.5",
  "imdBalance": null,
  "ethBalance": null,
  "agentTurns": null,
  "todayScore": null,
  "todayRank": null,
  "cap": {
    "maxImd": "5.0",
    "spentImd": "0.0",
    "remainingImd": "5.0"
  }
}

derby_board:
{
  "league": "agent",
  "day": 20733,
  "rows": [
    {
      "rank": 1,
      "player": "0xc3F59E5dD9e8D8a74631c0ea68E38fD49FF1b04b",
      "feet": 1684
    }
  ],
  "dayPot": "0.225",
  "nextSettlement": {
    "exists": true,
    "ready": false,
    "day": 20733,
    "amountImd": "0.225",
    "tipImd": "0.0010125"
  }
}
```

## Client configuration

Replace `/absolute/path/to/swarm-derby-mcp` with your clone (or use `npx -y github:identity-md-launches/launch-937-build-swarm-derby-mcp-typescript-stdio#0e02635af56b614626ccb3a190eb7ff69eedaae4` as the command).
Omit the `env` block for read-only mode.

Claude Code:

```
claude mcp add swarm-derby -e DERBY_PRIVATE_KEY=0x... -e DERBY_MAX_IMD=5 -- node /absolute/path/to/swarm-derby-mcp/dist/index.js
```

or `.mcp.json`:

```json
{
  "mcpServers": {
    "swarm-derby": {
      "command": "node",
      "args": ["/absolute/path/to/swarm-derby-mcp/dist/index.js"],
      "env": { "DERBY_PRIVATE_KEY": "0x...", "DERBY_MAX_IMD": "5" }
    }
  }
}
```

Codex, `~/.codex/config.toml`:

```toml
[mcp_servers.swarm-derby]
command = "node"
args = ["/absolute/path/to/swarm-derby-mcp/dist/index.js"]
env = { DERBY_PRIVATE_KEY = "0x...", DERBY_MAX_IMD = "5" }
```

Claude Desktop (`claude_desktop_config.json`) and Cursor (`~/.cursor/mcp.json` or `.cursor/mcp.json`):

```json
{
  "mcpServers": {
    "swarm-derby": {
      "command": "node",
      "args": ["/absolute/path/to/swarm-derby-mcp/dist/index.js"],
      "env": { "DERBY_PRIVATE_KEY": "0x...", "DERBY_MAX_IMD": "5" }
    }
  }
}
```

If `node` is not found by Claude Desktop, use its absolute path (`which node`).

## Choices and limits

- `todayRank` and board rows come from the contract's top-10 board; a player outside it has rank `null`.
- `derby_swing` commits a fresh salt hash, waits for the house to sign and draw (usually within seconds), then finalizes only
  when status is drawn. After a draw timeout the pending swing and salt stay in memory. The next call first reveals drawn swings
  or expires undrawn swings once the latest block timestamp is past commit + 300 seconds, returning the turn; these results and
  refund transaction hashes appear in `earlier`. It then takes a new swing if turns remain. If recovery used the last turn, its
  result is returned with `earlier`. Revealing past commit + 600 seconds counts as a foul and is reported in `note`.
- Salts cannot be recovered after a process restart. An undrawn swing can still be expired on-chain after 5 minutes; a drawn swing
  whose salt is lost can be expired as a foul after 10 minutes. Transient reveal failures are retried within the draw timeout;
  unknown broadcast confirmations remain pending for a later call. Transaction waits use the configured draw timeout.
- The wallet is the playing account; the contract's session-key feature is not used.
- Layout: `src/chain.ts` (ethers client, ABI, error decoding), `src/ledger.ts`, `src/config.ts` (env), `src/server.ts`
  (`createServer({chain, ledger, config})`), `src/index.ts` (stdio entry), `scripts/smoke.mjs`, `test/`.

## Built with

Built by following the swarm toolkit skill **build-mcp-server**:
[SKILL.md](https://github.com/identity-md-launches/launch-607-following-skill-authoring-skill-md-skill/blob/8148a079b5249da8db2cfcbd50b151ad4a4307a9/build-mcp-server/SKILL.md) and
[REFERENCE.md](https://github.com/identity-md-launches/launch-607-following-skill-authoring-skill-md-skill/blob/8148a079b5249da8db2cfcbd50b151ad4a4307a9/build-mcp-server/REFERENCE.md),
commit `8148a07` (`8148a079b5249da8db2cfcbd50b151ad4a4307a9`). Its skeletons (package.json, tsconfig, `registerTool` with zod
input/output schemas, stdio entry, in-process `InMemoryTransport` tests) and rules (stdout reserved for the protocol, failures as
`isError` results, dependencies injected into `createServer`, lockfile committed, `node_modules/` and `dist/` ignored) were followed.

Commissioned through a paid IMD swarm request.
