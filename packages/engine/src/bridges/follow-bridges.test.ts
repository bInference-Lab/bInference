import {
  type Amount,
  type ChainEvent,
  type ChainRegistry,
  chainRefSchema,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import { type Id, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { type BridgeBench, bridgeBench } from "../executor/test-bridge-bench.js";
import { driveUntil, tapped } from "../executor/test-executor.js";
import { restartBench } from "../executor/test-restart.js";
import { testToken, testWallet } from "../intents/test-intents.js";
import { testAccount, testCall } from "../operations/test-engine.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { createCardShowings } from "../surfaces/create-card-showings.js";
import type { BridgeRecord } from "./bridge-record.js";
import { bridgeLateAfterMs } from "./bridge-settlement.js";
import {
  testArrives,
  testBridge,
  testDestination,
  testFarEntry,
  testOtherArrives,
  testRoute,
} from "./test-bridges.js";

const live = { signal: new AbortController().signal };
const sourceChain = chainRefSchema.parse("fake:1");
const done = ["finalized", "reconciled", "failed_check", "failed_onchain", "expired"] as const;

function hashOf(byte: string): TxHash {
  const hash = `0x${byte.repeat(32)}`;
  if (!isTxHash(hash)) {
    throw new Error("Expected a hash.");
  }
  return hash;
}

// A bridge of 100 tokens, run on the bench to its final deposit, and its bridge in transit; its
// deposit lands on the source chain's reader, final, as a read of it finds it.
async function inTransit(
  bench: BridgeBench,
): Promise<{ readonly intent: Id<"int">; readonly bridge: BridgeRecord }> {
  const intent = await tapped(bench, testBridge());
  await bench.release();
  expect(await driveUntil(bench, intent, { states: done })).toBe("finalized");
  const bridge = await bench.test.stores.bridges.get(intent, live);
  if (bridge === undefined) {
    throw new Error("Expected the bridge in transit.");
  }
  bench.fakes.landsHere.land(bridge.depositTx, { recipient: testAccount, received: [] });
  return { intent, bridge };
}

// An event that names the deposits it settles, as the fake bridge takes its own.
const settling = (...deposits: readonly TxHash[]): readonly ChainEvent[] => [
  { emitter: testFarEntry.account, topics: [], data: `settles ${deposits.join(" ")}` },
];

// The bridge's venue says a fill on `chain` paid the entry `received` in that transaction, whose
// events name the bridge's deposit unless the landing gives others.
function filled(
  bench: BridgeBench,
  bridge: BridgeRecord,
  landing: {
    readonly received: Amount;
    readonly chain?: typeof testDestination;
    readonly events?: readonly ChainEvent[];
  },
) {
  const fill = { chain: landing.chain ?? testDestination, hash: hashOf("f1") };
  bench.fakes.bridge.settle(bridge.depositTx, { kind: "filled", fill });
  bench.fakes.landsThere.land(fill.hash, {
    recipient: testFarEntry.account,
    received: [landing.received],
    events: landing.events ?? settling(bridge.depositTx),
  });
}

async function follow(bench: BridgeBench): Promise<void> {
  await bench.test.engine.followBridges(live);
}

async function stateOf(bench: BridgeBench, intent: Id<"int">) {
  const record = await bench.test.stores.intents.get(intent, live);
  const bridge = await bench.test.stores.bridges.get(intent, live);
  return [record?.state, bridge?.state];
}

function noticesOf(bench: BridgeBench, key: string) {
  return bench.test.pushes.filter(
    (push) => push.kind === "notice/new" && JSON.stringify(push.data).includes(`"${key}"`),
  );
}

describe("following a bridge's delivery", () => {
  it("opens the bridge in transit once its deposit is final", async () => {
    const bench = await bridgeBench();
    const { bridge } = await inTransit(bench);
    expect(bridge).toMatchObject({
      state: "in_transit",
      toChain: testDestination,
      recipient: testFarEntry.account,
      sent: { asset: testToken, base: 100_000_000n },
      minOut: { asset: testArrives, base: 99_000_000n },
    });
    const departures = await bench.test.positions.executions(
      { after: 0, limit: 10, isPaper: false },
      live,
    );
    expect(departures).toStrictEqual([]);
  });

  it("reconciles once a read of the destination finds the payment, and only once", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    filled(bench, bridge, { received: { asset: testArrives, base: 99_000_000n } });

    await follow(bench);
    await follow(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["reconciled", "delivered"]);
    const settled = await bench.test.stores.bridges.get(intent, live);
    expect(settled).toMatchObject({
      fillTx: hashOf("f1"),
      received: { asset: testArrives, base: 99_000_000n },
      version: 1,
    });
    expect(noticesOf(bench, "notice.bridgeArrived")).toStrictEqual([]);
    const view = await bench.test.engine.handlers["intent/get"](testCall({ intent }));
    expect(view).toMatchObject({
      value: {
        state: "reconciled",
        delivery: {
          state: "delivered",
          toChain: testDestination,
          recipient: testFarEntry.account,
          fillTx: hashOf("f1"),
          received: { asset: testArrives, base: 99_000_000n },
        },
      },
    });
  });

  it("reconciles a delivery in another token against the least output in that token", async () => {
    const bench = await bridgeBench({ routes: [{ ...testRoute, arrives: testOtherArrives }] });
    const { intent, bridge } = await inTransit(bench);
    expect(bridge.minOut.asset).toBe(testOtherArrives);
    filled(bench, bridge, { received: { asset: testOtherArrives, base: 99_000_000n } });

    await follow(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["reconciled", "delivered"]);
  });

  it("leaves a bridge in transit while the read finds less than its least output, or another token", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    filled(bench, bridge, { received: { asset: testArrives, base: 98_999_999n } });
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "in_transit"]);

    filled(bench, bridge, { received: { asset: testOtherArrives, base: 99_000_000n } });
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "in_transit"]);
  });

  it("reads a fill only on the intent's own destination chain, whatever the venue names", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    bench.fakes.bridge.settle(bridge.depositTx, {
      kind: "filled",
      fill: {
        chain: sourceChain,
        hash: hashOf("f2"),
      },
    });
    bench.fakes.landsHere.land(hashOf("f2"), {
      recipient: testFarEntry.account,
      received: [{ asset: testArrives, base: 99_000_000n }],
    });

    await follow(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "in_transit"]);
  });

  it("marks a bridge late once after 2 hours, tells the owner once, and never ends it by time", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    await bench.test.clock.advance(bridgeLateAfterMs - 1);
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "in_transit"]);

    await bench.test.clock.advance(1);
    await follow(bench);
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "late"]);
    expect(noticesOf(bench, "notice.bridgeLate")).toHaveLength(1);

    await bench.test.clock.advance(7 * 86_400_000);
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "late"]);

    filled(bench, bridge, { received: { asset: testArrives, base: 99_000_000n } });
    await follow(bench);
    expect(await stateOf(bench, intent)).toStrictEqual(["reconciled", "delivered"]);
    expect(noticesOf(bench, "notice.bridgeArrived")).toHaveLength(1);
  });

  it("reconciles a refund read on the source chain, its units back as one arrival", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const refund = {
      chain: sourceChain,
      hash: hashOf("e1"),
    };
    bench.fakes.bridge.settle(bridge.depositTx, { kind: "refunded", refund });
    bench.fakes.landsHere.land(refund.hash, {
      recipient: testAccount,
      received: [{ asset: testToken, base: 100_000_000n }],
      events: settling(bridge.depositTx),
    });

    await follow(bench);
    await follow(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["reconciled", "refunded"]);
    const arrivals = await bench.test.positions.arrivals(
      { after: 0, limit: 10, isPaper: false, walletId: testWallet },
      live,
    );
    expect(arrivals.filter((arrival) => arrival.txHash === refund.hash)).toHaveLength(1);
    expect(noticesOf(bench, "notice.bridgeRefunded")).toHaveLength(1);
  });

  it("leaves a bridge in transit when the venue names a bare transfer to its recipient", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const received = { asset: testArrives, base: 99_000_000n };
    filled(bench, bridge, { received, events: [] });

    await follow(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["finalized", "in_transit"]);
  });

  it("settles only the bridge a fill names when two bridges to one address share it", async () => {
    const bench = await bridgeBench();
    const first = await inTransit(bench);
    const second = await inTransit(bench);
    const received = { asset: testArrives, base: 99_000_000n };
    filled(bench, first.bridge, { received });
    filled(bench, second.bridge, { received, events: settling(first.bridge.depositTx) });

    await follow(bench);

    expect(await stateOf(bench, first.intent)).toStrictEqual(["reconciled", "delivered"]);
    expect(await stateOf(bench, second.intent)).toStrictEqual(["finalized", "in_transit"]);
  });

  it("settles one bridge with a refund that names two deposits, and books its arrival once", async () => {
    const bench = await bridgeBench();
    const first = await inTransit(bench);
    const second = await inTransit(bench);
    const refund = { chain: sourceChain, hash: hashOf("e2") };
    bench.fakes.bridge.settle(first.bridge.depositTx, { kind: "refunded", refund });
    bench.fakes.bridge.settle(second.bridge.depositTx, { kind: "refunded", refund });
    bench.fakes.landsHere.land(refund.hash, {
      recipient: testAccount,
      received: [{ asset: testToken, base: 200_000_000n }],
      events: settling(first.bridge.depositTx, second.bridge.depositTx),
    });

    await follow(bench);
    await follow(bench);

    const states = [await stateOf(bench, first.intent), await stateOf(bench, second.intent)];
    expect(states).toStrictEqual([
      ["reconciled", "refunded"],
      ["finalized", "in_transit"],
    ]);
    const arrivals = await bench.test.positions.arrivals(
      { after: 0, limit: 10, isPaper: false, walletId: testWallet },
      live,
    );
    expect(
      arrivals.filter((arrival) => arrival.txHash === refund.hash).map(({ received }) => received),
    ).toStrictEqual([{ asset: testToken, base: 100_000_000n }]);
  });

  it("tells a late bridge's arrival once from recovery, after a stop between its row and intent", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const atMs = bridge.sentAtMs + bridgeLateAfterMs;
    const received = { asset: testArrives, base: 99_000_000n };
    const base = { intentId: intent, atMs };
    await bench.test.stores.bridges.move({ ...base, expectedVersion: 0, to: "late" }, live);
    const delivered = { ...base, expectedVersion: 1, fillTx: hashOf("f1"), received };
    await bench.test.stores.bridges.move({ ...delivered, to: "delivered" }, live);

    const restarted = await restartBench(bench);

    expect(await stateOf(bench, intent)).toStrictEqual(["reconciled", "delivered"]);
    const arrived = restarted.pushes.filter((push) =>
      JSON.stringify(push.data).includes("notice.bridgeArrived"),
    );
    expect(arrived).toHaveLength(1);
  });
});

// The bench's registry with the destination listed beside the fake chain, as Fake Two with its
// own block explorer, as the registry lists each chain a bridge delivers to.
function withDestination(bench: BridgeBench): ChainRegistry {
  const chains = bench.fakes.chains;
  return {
    get(ref) {
      const found = chains.get(ref === testDestination ? sourceChain : ref);
      if (ref !== testDestination || !found.ok) {
        return found;
      }
      const explorers = [{ ...twoScan, url: "https://two.example.invalid" }];
      const definition = { ...found.value.definition, id: "fake:2", name: "Fake Two", explorers };
      return ok({ ...found.value, ref, definition });
    },
    list: () => chains.list(),
  };
}

const twoScan = {
  name: "two-scan",
  txUrl: "https://two.example.invalid/tx/{hash}",
  source: "https://example.invalid/two-scan",
};

// The card receipts as the owner's surfaces read them, over the bench's stores and bridges.
function receiptOf(bench: BridgeBench, intent: Id<"int">, chains = withDestination(bench)) {
  const showings = createCardShowings({
    ...bench.test.stores,
    chains,
    venues: { hasNoDeadline: () => false },
  });
  return showings.settled(intent, live);
}

// The moves the engine and its executor pushed into `state` for the intent.
function movesInto(pushes: readonly EnginePush[], intent: Id<"int">, state: string) {
  return pushes.filter((push) => {
    const data = JSON.stringify(push.data);
    return (
      push.kind === "intent/changed" &&
      data.includes(`"intent":"${intent}"`) &&
      data.includes(`"state":"${state}"`)
    );
  });
}

describe("a bridge's receipt", () => {
  it("says it left once its deposit lands, with the deposit's link, before and after its row opens", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const deposit = { explorerLink: `https://scan.example.invalid/tx/${bridge.depositTx}` };
    const sent = {
      kind: "bridgeSent",
      fromChain: "Fake One",
      chain: "Fake Two",
      minutes: 1,
      tx: deposit,
    };

    expect(movesInto(bench.pushes, intent, "finalized")).toHaveLength(1);
    expect((await receiptOf(bench, intent))?.live?.outcome).toStrictEqual(sent);
    const { bridges: _bridges, ...stores } = bench.test.stores;
    const unread = createCardShowings({
      ...stores,
      chains: withDestination(bench),
      venues: { hasNoDeadline: () => false },
    });
    expect((await unread.settled(intent, live))?.live?.outcome).toStrictEqual(sent);
  });

  it("says who received what on the destination, with the fill's link there, once across a restart", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    filled(bench, bridge, { received: { asset: testArrives, base: 99_000_000n } });

    await follow(bench);
    const restarted = await restartBench(bench);
    await follow(bench);

    const pushes = [...bench.pushes, ...bench.test.pushes, ...restarted.pushes];
    expect(movesInto(pushes, intent, "reconciled")).toHaveLength(1);
    const ended = await receiptOf(bench, intent);
    expect(ended?.live?.outcome).toStrictEqual({
      kind: "bridgeDelivered",
      chain: "Fake Two",
      recipient: testFarEntry.account,
      payee: { label: "exchange" },
      received: { asset: testArrives, base: 99_000_000n },
      tx: { explorerLink: `https://two.example.invalid/tx/${hashOf("f1")}` },
    });
    expect(ended?.live?.assets[testArrives]).toMatchObject({ symbol: "TKN", decimals: 6 });
    const bare = await receiptOf(bench, intent, bench.fakes.chains);
    expect(bare?.live?.outcome).toMatchObject({ tx: { hash: hashOf("f1") } });
  });

  it("says the venue paid the amount back to the wallet, with the refund's link, once across a restart", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const refund = { chain: sourceChain, hash: hashOf("e1") };
    bench.fakes.bridge.settle(bridge.depositTx, { kind: "refunded", refund });
    bench.fakes.landsHere.land(refund.hash, {
      recipient: testAccount,
      received: [{ asset: testToken, base: 100_000_000n }],
      events: settling(bridge.depositTx),
    });

    await follow(bench);
    const restarted = await restartBench(bench);
    await follow(bench);

    const pushes = [...bench.pushes, ...bench.test.pushes, ...restarted.pushes];
    expect(movesInto(pushes, intent, "reconciled")).toHaveLength(1);
    expect((await receiptOf(bench, intent))?.live?.outcome).toStrictEqual({
      kind: "bridgeRefunded",
      venue: "fake-cross",
      amount: { asset: testToken, base: 100_000_000n },
      wallet: "main",
      tx: { explorerLink: `https://scan.example.invalid/tx/${hashOf("e1")}` },
    });
  });

  it("gives an intent's view the line its card ends with, on its way and once delivered", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const sent = { key: "receipt.bridgeSent" };
    const viewed = await bench.test.engine.handlers["intent/get"](testCall({ intent }));
    const listed = await bench.test.engine.handlers["intent/list"](testCall({ kind: "bridge" }));
    expect(viewed).toMatchObject({ value: { bridgeReceipt: sent } });
    expect(listed).toMatchObject({ value: { items: [{ bridgeReceipt: sent }] } });

    filled(bench, bridge, { received: { asset: testArrives, base: 99_000_000n } });
    await follow(bench);

    const got = await bench.test.engine.handlers["intent/get"](testCall({ intent }));
    const payee = {
      key: "card.value.payee",
      values: {
        label: { type: "text", text: "exchange" },
        address: { type: "text", text: "0x000000b1" },
      },
    };
    const txHash = { type: "text", text: hashOf("f1") };
    expect(got).toMatchObject({
      value: {
        bridgeReceipt: {
          key: "receipt.bridgeDelivered",
          values: {
            chain: { type: "text", text: "Fake Two" },
            recipient: { type: "line", line: payee },
            received: { type: "amount", amount: { asset: testArrives, base: 99_000_000n } },
            explorerLink: { type: "line", line: { key: "receipt.tx", values: { txHash } } },
          },
        },
        assets: { [testArrives]: { symbol: "TKN" } },
      },
    });
  });

  it("says it was delivered once when recovery reconciles a delivery a stop cut short", async () => {
    const bench = await bridgeBench();
    const { intent, bridge } = await inTransit(bench);
    const received = { asset: testArrives, base: 99_000_000n };
    const delivered = { intentId: intent, atMs: bridge.sentAtMs, expectedVersion: 0 };
    await bench.test.stores.bridges.move(
      { ...delivered, to: "delivered", fillTx: hashOf("f1"), received },
      live,
    );

    const restarted = await restartBench(bench);
    await follow(bench);

    expect(movesInto(restarted.pushes, intent, "reconciled")).toHaveLength(1);
    expect(movesInto(bench.test.pushes, intent, "reconciled")).toStrictEqual([]);
    expect((await receiptOf(bench, intent))?.live?.outcome).toMatchObject({
      kind: "bridgeDelivered",
      received,
    });
  });
});
