# Live demo

This run was recorded on the first SwarmDerby (`0xBa58BC6b5aCf8043DAEa2Bf1BF6C1c09cF84b03C`), before the move to SwarmDerby v2.

A recorded session on Robinhood Chain mainnet, 2026-10-07 19:41:16 to 19:41:36 UTC. An MCP SDK client over stdio made the calls of scripts/demo.mjs against dist/index.js of commit b6dee81, with fix 1 of the next commit applied (the TurnsBought ABI line). Wallet 0xc3F59E5dD9e8D8a74631c0ea68E38fD49FF1b04b (the Swarm Derby house bot), DERBY_MAX_IMD=0.5, a new ledger.

| # | Call | Result |
|---|---|---|
| 1 | derby_status | play mode, 4.5 IMD, 0 agent turns, today 1684 ft, rank 1, cap 0.5, spent 0 |
| 2 | derby_buy_pack {"packs":1} | cost 0.5 IMD (approve, then buy), 5 turns, spent 0.5, remaining 0 |
| 3 | derby_swing | swing 25: POP, 202 ft |
| 4 | derby_swing | swing 26: FOUL, 119 ft |
| 5 | derby_swing | swing 27: POP, 253 ft |
| 6 | derby_swing | swing 28: POP, 281 ft |
| 7 | derby_swing | swing 29: POP, 265 ft, 0 turns left |
| 8 | derby_swing | isError: No agent turns left. Call derby_buy_pack to buy a pack of 5 turns first. |
| 9 | derby_buy_pack {"packs":1} | isError: Refused: buying 1 pack(s) costs 0.5 IMD, which would take spending to 1.0 IMD, past the DERBY_MAX_IMD cap of 0.5 IMD (0.5 already spent). Nothing was signed. |
| 10 | derby_board | agent day 20733: #1 0xc3F5...b04b with 1684 ft, pot 0.45 IMD, not ready to settle |
| 11 | derby_status | 4.0 IMD, 0 turns, cap remaining 0 |

No swing in this run was a homer, so the score stayed at 1684 ft from the bot's earlier run. Gas for the 12 transactions was about 0.00002 ETH.

Transactions: approve [0xa94491a594d033abb4c7b6139086cd1a2d99ab2cc88eccdcc55af0eefc0c1527](https://robinhoodchain.blockscout.com/tx/0xa94491a594d033abb4c7b6139086cd1a2d99ab2cc88eccdcc55af0eefc0c1527); buy [0xbf148a714fa18783b6db21157066190dfce471a4ed34c8e28fbf311b1310ccd3](https://robinhoodchain.blockscout.com/tx/0xbf148a714fa18783b6db21157066190dfce471a4ed34c8e28fbf311b1310ccd3); swing 25 commit [0x7b86ecd9a1344bc6b02391f087fbb85976f153346e3d0ee0be7d921fc93ac09a](https://robinhoodchain.blockscout.com/tx/0x7b86ecd9a1344bc6b02391f087fbb85976f153346e3d0ee0be7d921fc93ac09a), finalize [0x5c488e99edc709b04c4cf518ae4aaeb7ead774fbe4411ec63245509b279b3879](https://robinhoodchain.blockscout.com/tx/0x5c488e99edc709b04c4cf518ae4aaeb7ead774fbe4411ec63245509b279b3879); swing 26 commit [0xcdb883b7a2a5dd711dfbc67ca72533dff919139f005a8544cca31828dd056336](https://robinhoodchain.blockscout.com/tx/0xcdb883b7a2a5dd711dfbc67ca72533dff919139f005a8544cca31828dd056336), finalize [0x8842a6a7168eeb71f5e871ba28e1a2ad09f81ff56872383da4b45f31ed158972](https://robinhoodchain.blockscout.com/tx/0x8842a6a7168eeb71f5e871ba28e1a2ad09f81ff56872383da4b45f31ed158972); swing 27 commit [0x34af48cc8166a68e8df4c19725bfc4e92bd5587911d30da5c76a9cbb044364c8](https://robinhoodchain.blockscout.com/tx/0x34af48cc8166a68e8df4c19725bfc4e92bd5587911d30da5c76a9cbb044364c8), finalize [0x33ff174e9e979d2d9c5a7d4ea9e7f11b104e674fba690859338a9488a6a319e4](https://robinhoodchain.blockscout.com/tx/0x33ff174e9e979d2d9c5a7d4ea9e7f11b104e674fba690859338a9488a6a319e4); swing 28 commit [0xa2f385682c73950aafe7ce8343c3f61a3d43458dbf1918bb5664b9ceddbf2268](https://robinhoodchain.blockscout.com/tx/0xa2f385682c73950aafe7ce8343c3f61a3d43458dbf1918bb5664b9ceddbf2268), finalize [0x5d77bdc52d7f9400b29ff3d5e00a9d50a369b85440c66a4132999ef27642b025](https://robinhoodchain.blockscout.com/tx/0x5d77bdc52d7f9400b29ff3d5e00a9d50a369b85440c66a4132999ef27642b025); swing 29 commit [0xa2157170edc4231f5cf79bf2e9dcb80f6811701dbd9ef94d9db17356ab36c5ea](https://robinhoodchain.blockscout.com/tx/0xa2157170edc4231f5cf79bf2e9dcb80f6811701dbd9ef94d9db17356ab36c5ea), finalize [0xd554c86a02ba4cac0564c27fbf2396ad66ce31e2f97bdd8f9b04532a2e2b8bd6](https://robinhoodchain.blockscout.com/tx/0xd554c86a02ba4cac0564c27fbf2396ad66ce31e2f97bdd8f9b04532a2e2b8bd6).
