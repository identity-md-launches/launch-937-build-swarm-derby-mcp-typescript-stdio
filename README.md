# swarm-derby-mcp

[Live demo](DEMO.md)

A stdio [MCP](https://modelcontextprotocol.io) server that lets any MCP client play the **Agent league** of
[Swarm Derby](https://swarm-derby.sites.imd.fun), a live game on Robinhood Chain mainnet (chain 4663), with a hard IMD spending cap.
Game contract: `0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C`; ABI from
[SwarmDerby.sol @ 589f934](https://github.com/pepegobig/swarm-derby-contracts/blob/589f934eac858dfe866bfce31382f7a85b243501/src/SwarmDerby.sol),
play loop copied from the reference player [agent-bot.mjs @ 8cac8de](https://github.com/pepegobig/swarm-derby-site/blob/8cac8de200c1d5e466a80bc4950e4f13990b9efd/agent-bot.mjs).

> **Warning: this plays a live mainnet game with real IMD.** Experimental, no warranty. Use a **fresh wallet** that holds only
> the IMD you are willing to spend plus a little ETH for gas. Never reuse a wallet that holds anything else.

## Tools

| Tool | Inputs | Returns | `isError` when |
| --- | --- | --- | --- |
| `derby_status` | none | `mode` (read-only / play), `wallet`, `day`, `packPrice`, `imdBalance`, `ethBalance`, `agentTurns`, `todayScore`, `todayRank`, `cap {maxImd, spentImd, remainingImd}` | RPC failure |
| `derby_board` | `league` `"agent"`\|`"arcade"` (default agent); `day` int ≥ 0 (default today) | `rows [{rank, player, feet}]`, `dayPot`, `nextSettlement` | `day` is in the future |
| `derby_buy_pack` | `packs` int 1-10 (required) | `txHashes`, `costImd`, `turnsAdded`, `agentTurns`, `cap` | no key; `spent + cost` would pass the cap; IMD short; no ETH for gas (all checked before any signature) |
| `derby_swing` | `quality` int 1-100 (default 100); `velo` int 0-100 (default 100) | `swingId`, `tier`, `tierName`, `feet`, `homer`, `todayScore`, `turnsLeft`, `txHashes` | no key or no turns (names `derby_buy_pack`); no ETH; reveal timeout or failure (message carries the `swingId`) |
| `derby_settle` | `league` (default agent) | `day`, `winners [{player, amountImd}]`, `tipImd`, `txHash` | no key; nothing to settle; day not closed yet (says why); no ETH |

Amounts are decimal IMD strings. Tiers 0-5 are WHIFF FOUL POP HOMER BOMB SLAM; tier 3+ is a homer and scores feet. Days are UTC
(`unix seconds / 86400`). Contract custom errors (`NoTurns`, `DayNotOver`, `TooEarly`, ...) are decoded into plain sentences.
A pack is 5 turns; the price is read from the contract (`packPrice()`), never hard-coded.

## Environment

| Variable | Default | Meaning |
| --- | --- | --- |
| `DERBY_PRIVATE_KEY` | none | Wallet key. Optional: without it the server is read-only and the write tools return `isError`. Read only from the environment; never logged, returned or written. |
| `DERBY_RPC_URL` | `https://rpc.mainnet.chain.robinhood.com` | JSON-RPC endpoint. |
| `DERBY_CONTRACT` | `0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C` | SwarmDerby address. |
| `DERBY_MAX_IMD` | `5` | Hard cap, in IMD, on total pack spending per wallet. |
| `DERBY_LEDGER` | `~/.swarm-derby-mcp/ledger.json` | Spending ledger file. |
| `DERBY_REVEAL_TIMEOUT_MS` | `60000` | How long `derby_swing` waits for the target block (polled every ~250 ms). |

## The cap and the ledger

- `derby_buy_pack` computes `cost = packs x packPrice()` and refuses unless `spent + cost <= DERBY_MAX_IMD`, the wallet holds
  enough IMD, and it has ETH for gas. All refusals happen before any signature, so nothing is approved or bought.
- When the allowance is short it approves **only the exact cost**, then calls `buyPacks(1, packs)`.
- The ledger stores reserved/spent wei per wallet address (`{"spent": {"0xwallet": "wei"}}`, file mode 0600). A buy reserves its
  cost before broadcasting, so a mined-but-unconfirmed RPC failure or process restart cannot silently reset the cap. An unknown
  confirmation remains counted; only a receipt that proves a revert releases the reservation. File-ledger instances also take an
  exclusive lock around the cap check, reservation, approval and buy, so multiple MCP processes sharing a ledger cannot both pass.
  On confirmation, the `TurnsBought` event's actual cost replaces the preflight estimate. Deleting the ledger resets the cap: it is
  a guard against runaway agents, not against the key's owner. A corrupt ledger makes buys fail rather than silently resetting.
- Swing salts are generated per swing, kept only in memory and never logged or returned. Logs go to stderr.
- Only IMD spent on packs counts toward the cap; gas (ETH) does not. `derby_settle` costs gas only and may earn a small tip.

## Run

Node 20+.

```
npx -y github:identity-md-launches/launch-937-build-swarm-derby-mcp-typescript-stdio      # builds on install via "prepare"
```

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
  ✔ persists spend per wallet across instances (3.022378ms)
  ✔ refuses to reset the cap on a corrupt file (0.620108ms)
✔ FileLedger (6.768473ms)
▶ loadEnv
  ✔ applies defaults (6.265315ms)
  ✔ rejects a bad cap (0.400108ms)
✔ loadEnv (6.845982ms)
▶ explainError
  ✔ decodes custom errors into sentences (0.282629ms)
✔ explainError (2.43878ms)
▶ tools/list
  ✔ lists exactly the five tools with the requested inputs (218.364742ms)
✔ tools/list (225.599143ms)
▶ derby_status
  ✔ reports play mode with balances, score, rank and cap (44.999626ms)
  ✔ is read-only without a key (26.803592ms)
  ✔ returns isError when the chain fails (7.072202ms)
✔ derby_status (79.354056ms)
▶ derby_board
  ✔ returns ranked rows, pot and next settlement (17.543299ms)
  ✔ refuses a future day (15.826616ms)
  ✔ rejects a bad league (6.561403ms)
✔ derby_board (40.302937ms)
▶ derby_buy_pack
  ✔ approves exactly the cost, buys, and records the spend (4.917479ms)
  ✔ skips the approval when the allowance already covers the cost (6.484574ms)
  ✔ releases the cap reservation when buyPacks confirms a revert (10.109289ms)
  ✔ refuses a buy past the cap before signing anything (4.470142ms)
  ✔ holds the cap across two buys (6.208525ms)
  ✔ refuses without a key, with short IMD, or with no ETH (29.860348ms)
  ✔ rejects packs outside 1-10 (7.533599ms)
✔ derby_buy_pack (73.083273ms)
▶ derby_swing
  ✔ commits, waits for the target block, reveals and reports (43.232234ms)
  ✔ reports a non-homer (26.816501ms)
  ✔ names derby_buy_pack when there are no turns or no key (18.515805ms)
  ✔ times out waiting for the target block and names the swing (44.455259ms)
  ✔ returns isError with the swingId when the reveal fails (205.303676ms)
  ✔ rejects out-of-range quality and velo (8.609455ms)
✔ derby_swing (347.671057ms)
▶ derby_settle
  ✔ settles a closed day and returns winners, amounts and tip (5.729987ms)
  ✔ explains when nothing waits (1.267345ms)
  ✔ explains when the day is not closed (11.127734ms)
  ✔ needs a key (3.458977ms)
✔ derby_settle (21.797661ms)
✔ decodes the real TurnsBought log from Robinhood Chain block 82726982 (18.663895ms)
ℹ tests 30
ℹ suites 9
ℹ pass 30
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 3953.825268
```

30 tests: the five tool names, a success and an `isError` call for each tool, a buy past the cap with no approve or `buyPacks`
recorded, approvals equal to the exact cost, plus ledger, env and error-decoding tests, confirmed-revert reservation release, and decoding a real TurnsBought log.

### `npm run smoke` (this run; no key, live RPC)

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

Replace `/absolute/path/to/swarm-derby-mcp` with your clone (or use `npx -y github:identity-md-launches/launch-937-build-swarm-derby-mcp-typescript-stdio` as the command).
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
- If `derby_swing` times out waiting for the target block, the swing stays committed; the salt is in memory only, so it cannot be
  recovered after a process restart and counts as a foul if left unrevealed past 255 blocks. Transient reveal errors are retried
  with the same in-memory salt until `DERBY_REVEAL_TIMEOUT_MS`; a broadcast transaction wait is bounded by that same timeout.
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
