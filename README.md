# swarm-derby-mcp

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
- The ledger stores spent wei per wallet address (`{"spent": {"0xwallet": "wei"}}`, file mode 0600) and is rewritten atomically right
  after each buy, so the cap holds across restarts. Deleting the ledger resets the cap: it is a guard against runaway agents, not
  against the key's owner. A corrupt ledger makes buys fail rather than silently resetting.
- Write tools run one at a time, so concurrent calls cannot both pass the cap check.
- Swing salts are generated per swing, kept only in memory and never logged or returned. Logs go to stderr.
- Only IMD spent on packs counts toward the cap; gas (ETH) does not. `derby_settle` costs gas only and may earn a small tip.

## Run

Node 20+.

```
npx -y github:<owner>/swarm-derby-mcp      # builds on install via "prepare"
```

or from a clone:

```
npm install      # also builds dist/
npm run typecheck
npm test
npm run build
npm run smoke    # live read-only check, see below
```

### `npm test` (this run; fake chain and in-memory ledger, no network)

```
✔ persists spend per wallet across instances
  ✔ refuses to reset the cap on a corrupt file
  ✔ applies defaults
  ✔ rejects a bad cap
  ✔ decodes custom errors into sentences
  ✔ lists exactly the five tools with the requested inputs
  ✔ reports play mode with balances, score, rank and cap
  ✔ is read-only without a key
  ✔ returns isError when the chain fails
  ✔ returns ranked rows, pot and next settlement
  ✔ refuses a future day
  ✔ rejects a bad league
  ✔ approves exactly the cost, buys, and records the spend
  ✔ skips the approval when the allowance already covers the cost
  ✔ refuses a buy past the cap before signing anything
  ✔ holds the cap across two buys
  ✔ refuses without a key, with short IMD, or with no ETH
  ✔ rejects packs outside 1-10
  ✔ commits, waits for the target block, reveals and reports
  ✔ reports a non-homer
  ✔ names derby_buy_pack when there are no turns or no key
  ✔ times out waiting for the target block and names the swing
  ✔ returns isError with the swingId when the reveal fails
  ✔ rejects out-of-range quality and velo
  ✔ settles a closed day and returns winners, amounts and tip
  ✔ explains when nothing waits
  ✔ explains when the day is not closed
  ✔ needs a key
ℹ tests 28
ℹ pass 28
ℹ fail 0
```

28 tests: the five tool names, a success and an `isError` call for each tool, a buy past the cap with no approve or `buyPacks`
recorded, approvals equal to the exact cost, plus ledger, env and error-decoding tests.

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

Replace `/absolute/path/to/swarm-derby-mcp` with your clone (or use `npx -y github:<owner>/swarm-derby-mcp` as the command).
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
- If `derby_swing` times out waiting for the target block, the swing stays committed; the salt is in memory only, so it is not
  retried and counts as a foul if left unrevealed past 255 blocks.
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
