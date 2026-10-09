import { strict as assert } from "node:assert";
import { it } from "node:test";
import { Interface, parseEther } from "ethers";
import { DERBY_ABI, parseDerbyEvent } from "../src/chain.js";

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

it("ignores foreign-address logs and accepts the configured address case-insensitively", () => {
  const iface = new Interface(DERBY_ABI);
  const contract = "0x53d9aa0b925c5148bcc5f98f394872687f4c831c";
  const encoded = iface.encodeEventLog(iface.getEvent("TurnsBought")!, [
    "0x1111111111111111111111111111111111111111", 1, 5, parseEther("0.5"), parseEther("0.2"),
  ]);
  const foreign = { ...encoded, address: "0x2222222222222222222222222222222222222222" };
  assert.equal(parseDerbyEvent([foreign], "TurnsBought", contract), null);
  const real = { ...encoded, address: contract.toUpperCase() };
  assert.equal(parseDerbyEvent([foreign, real], "TurnsBought", contract)?.args.cost, parseEther("0.5"));
});

it("decodes v2 committed, drawn and refunded events and the swings tuple", () => {
  const iface = new Interface(DERBY_ABI);
  const committed = iface.encodeEventLog(iface.getEvent("SwingCommitted")!, [
    42, "0x1111111111111111111111111111111111111111", 1, 100, 100, 1000,
  ]);
  assert.equal(iface.parseLog(committed)?.args.committedAt, 1000n);
  assert.ok(iface.getFunction("swings"));
  assert.ok(iface.getFunction("expire"));
  assert.ok(iface.getEvent("SwingDrawn"));
  assert.ok(iface.getEvent("SwingRefunded"));
  assert.equal(iface.getError("TooEarly"), null);
});
