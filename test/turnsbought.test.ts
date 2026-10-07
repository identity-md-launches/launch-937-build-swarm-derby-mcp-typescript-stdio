import { strict as assert } from "node:assert";
import { it } from "node:test";
import { Interface, parseEther } from "ethers";
import { DERBY_ABI } from "../src/chain.js";

it("decodes the real TurnsBought log from Robinhood Chain block 82726982", () => {
  // Transaction 0xbf148a714fa18783b6db21157066190dfce471a4ed34c8e28fbf311b1310ccd3.
  const log = {
    address: "0xba58bc6b5acf8043daea2bf1bf6c1c09cf84b03c",
    topics: [
      "0x13daa21a239e5704156c30acf2e5703c9ffd93f09461b809fb3df4c6ce5bfa98",
      "0x000000000000000000000000c3f59e5dd9e8d8a74631c0ea68e38fd49ff1b04b",
      "0x0000000000000000000000000000000000000000000000000000000000000001",
    ],
    data: "0x000000000000000000000000000000000000000000000000000000000000000500000000000000000000000000000000000000000000000006f05b59d3b2000000000000000000000000000000000000000000000000000002c68af0bb140000",
  };
  const event = new Interface(DERBY_ABI).parseLog(log);
  assert.ok(event);
  assert.equal(event.name, "TurnsBought");
  assert.equal(event.args.player, "0xc3F59E5dD9e8D8a74631c0ea68E38fD49FF1b04b");
  assert.equal(event.args.league, 1n);
  assert.equal(event.args.count, 5n);
  assert.equal(event.args.cost, parseEther("0.5"));
  assert.equal(event.args.burned, parseEther("0.2"));
});
