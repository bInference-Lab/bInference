import { accountRefSchema, assetRefSchema, chainRefSchema, isTxHash } from "@binference/chain";
import type { Id } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentRecord } from "../intents/intent-record.js";
import type { BridgeQuery, BridgeRecord } from "./bridge-record.js";
import { bridgesInTransit } from "./bridges-in-transit.js";

const live = { signal: new AbortController().signal };
const ours = fixtureId("wal", 1);
const theirs = fixtureId("wal", 2);
const token = assetRefSchema.parse("fake:1/token:0x0000000a");
const recipient = accountRefSchema.parse("fake:2:0x0000000c");
const depositTx = `0x${"ab".repeat(32)}`;

function bridgeOf(index: number, state: BridgeRecord["state"]): BridgeRecord {
  if (!isTxHash(depositTx)) {
    throw new Error("The fixture's hash is not one.");
  }
  return {
    intentId: fixtureId("int", index),
    venue: "fake-bridge",
    depositTx,
    toChain: chainRefSchema.parse("fake:2"),
    recipient,
    sent: { asset: token, base: BigInt(index) },
    minOut: { asset: assetRefSchema.parse("fake:2/slip44:1"), base: 1n },
    ...(index % 2 === 0 ? { valueUsdMicros: BigInt(index) * 10n } : {}),
    sentAtMs: index,
    state,
    version: 0,
  };
}

// 250 open bridges, their intents in our wallet when even, another wallet's when odd, read a
// page at a time as the store reads them.
function partsOf() {
  const asked: BridgeQuery[] = [];
  const open = Array.from({ length: 250 }, (_, index) =>
    bridgeOf(index + 1, index === 1 ? "late" : "in_transit"),
  );
  const walletOf = new Map<Id<"int">, Id<"wal">>(
    open.map((bridge, index) => [bridge.intentId, index % 2 === 1 ? ours : theirs]),
  );
  const parts = {
    bridges: {
      list: async (query: BridgeQuery) => {
        asked.push(query);
        const after = query.after?.sentAtMs ?? 0;
        return Promise.resolve(open.filter((row) => row.sentAtMs > after).slice(0, query.limit));
      },
    },
    intents: {
      get: async (intentId: Id<"int">) =>
        Promise.resolve({ walletId: walletOf.get(intentId) } as IntentRecord),
    },
  };
  return { parts, asked };
}

describe("the bridges in transit", () => {
  it("pages through every open bridge and keeps those of the wallets named, at their departure value", async () => {
    const { parts, asked } = partsOf();
    const held = await bridgesInTransit(parts, new Set([ours]), live);
    expect(asked.map((query) => [query.states, query.limit, query.after?.sentAtMs])).toStrictEqual([
      [["in_transit", "late"], 100, undefined],
      [["in_transit", "late"], 100, 100],
      [["in_transit", "late"], 100, 200],
    ]);
    expect(held).toHaveLength(125);
    expect(held.slice(0, 2)).toStrictEqual([
      {
        intentId: fixtureId("int", 2),
        walletId: ours,
        amount: { asset: token, base: 2n },
        usdMicros: 20n,
        toChain: "fake:2",
        recipient,
        sentAtMs: 2,
        late: true,
      },
      {
        intentId: fixtureId("int", 4),
        walletId: ours,
        amount: { asset: token, base: 4n },
        usdMicros: 40n,
        toChain: "fake:2",
        recipient,
        sentAtMs: 4,
        late: false,
      },
    ]);
  });

  it("names each bridge's destination chain as its quote does", async () => {
    const { parts } = partsOf();
    const amount = { asset: token, base: 2n };
    const quote = bridgeQuoteDocument.encode({
      venue: "fake-bridge",
      chainName: "Base",
      amount,
      recipient,
      recipientBytes: "0x0c",
      expectedOut: amount,
      minOut: amount,
      fees: [],
      etaSeconds: 60,
      quotedAtMs: 1,
      expiresAtMs: 60_001,
      deposit: { kind: "bound", contract: recipient, destinationId: "2" },
    });
    const named = {
      ...parts,
      intents: {
        get: async () => Promise.resolve({ walletId: ours, kind: "bridge", quote } as IntentRecord),
      },
    };
    const held = await bridgesInTransit(named, new Set([ours]), live);
    expect(held.map(({ chainName }) => chainName)).toStrictEqual(held.map(() => "Base"));
    expect(held).toHaveLength(250);
  });

  it("reads nothing for no wallet", async () => {
    const { parts, asked } = partsOf();
    expect(await bridgesInTransit(parts, new Set(), live)).toStrictEqual([]);
    expect(asked).toStrictEqual([]);
  });
});
