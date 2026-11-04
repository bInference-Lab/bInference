import {
  accountRefSchema,
  assetRefSchema,
  type Bridge,
  chainRefSchema,
  type ChainEvent,
  type TxHash,
} from "@binference/chain";
import { createFakeDeliveryReader, type FakeDeliveryReader } from "@binference/chain/testing";
import { err, ok } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import type { BridgeRecord } from "./bridge-record.js";
import { readDeposit, readFill, readRefund } from "./read-delivery.js";

const { signal } = new AbortController();
const source = chainRefSchema.parse("fake:1");
const destination = chainRefSchema.parse("fake:2");
const sentToken = assetRefSchema.parse("fake:1/token:0x000000f1");
const arrives = assetRefSchema.parse("fake:2/token:0x000000f3");
const coinThere = assetRefSchema.parse("fake:2/slip44:1");
const wallet = accountRefSchema.parse("fake:1:0x000000a1");
const recipient = accountRefSchema.parse("fake:2:0x000000b1");
const depositTx = `0x${"d1".repeat(32)}` as TxHash;
const fillTx = `0x${"f1".repeat(32)}` as TxHash;
const refundTx = `0x${"e1".repeat(32)}` as TxHash;
const fillEvent: ChainEvent = {
  emitter: accountRefSchema.parse("fake:1:0x000000e1"),
  topics: [],
  data: "0xd1",
};

const bridge: BridgeRecord = {
  intentId: fixtureId("int", 1),
  venue: "fake-cross",
  depositTx,
  toChain: destination,
  recipient,
  sent: { asset: sentToken, base: 100n },
  minOut: { asset: arrives, base: 90n },
  sentAtMs: 1,
  state: "in_transit",
  version: 0,
};

// A venue whose settlement events say it paid `paid` for this deposit, or name none of its own.
function venuePaying(paid: bigint | undefined): Pick<Bridge, "settlement"> {
  return { settlement: () => (paid === undefined ? err("not_own") : ok(paid)) };
}

function readers(): { readonly here: FakeDeliveryReader; readonly there: FakeDeliveryReader } {
  return { here: createFakeDeliveryReader(source), there: createFakeDeliveryReader(destination) };
}

const deposit = { ref: { chain: source, hash: depositTx }, events: [] };

function fillReading(paid: bigint | undefined, record: BridgeRecord = bridge) {
  return {
    bridge: record,
    venue: venuePaying(paid),
    deposit,
    wallet,
    fill: { chain: destination, hash: fillTx },
  };
}

function refundReading(paid: bigint | undefined, chain = source) {
  return { bridge, venue: venuePaying(paid), deposit, wallet, refund: { chain, hash: refundTx } };
}

describe("reading a bridge's deposit", () => {
  it("answers the deposit with its events once a final block holds it", async () => {
    const { here } = readers();
    here.land(depositTx, { recipient: wallet, received: [], events: [fillEvent] });
    await expect(readDeposit([here], { bridge, wallet }, signal)).resolves.toStrictEqual({
      ref: { chain: source, hash: depositTx },
      events: [fillEvent],
    });
  });

  it("answers none while no final block holds it, it failed, or no reader serves its chain", async () => {
    const { here, there } = readers();
    here.land(depositTx, { recipient: wallet, received: [], final: false });
    await expect(readDeposit([here], { bridge, wallet }, signal)).resolves.toBeUndefined();
    here.land(depositTx, { recipient: wallet, received: [], status: "failed" });
    await expect(readDeposit([here], { bridge, wallet }, signal)).resolves.toBeUndefined();
    await expect(readDeposit([there], { bridge, wallet }, signal)).resolves.toBeUndefined();
  });
});

describe("reading a bridge's fill (decision 0320)", () => {
  it("counts no more than the venue says this deposit was paid", async () => {
    const { there } = readers();
    there.land(fillTx, { recipient, received: [{ asset: arrives, base: 150n }] });
    await expect(readFill([there], fillReading(95n), signal)).resolves.toStrictEqual({
      tx: fillTx,
      received: { asset: arrives, base: 95n },
    });
  });

  it("finds none on another chain, with no reader, or in a transaction the venue does not own", async () => {
    const { here, there } = readers();
    there.land(fillTx, { recipient, received: [{ asset: arrives, base: 95n }] });
    const elsewhere = { ...fillReading(95n), fill: { chain: source, hash: fillTx } };
    await expect(readFill([there], elsewhere, signal)).resolves.toBeUndefined();
    await expect(readFill([here], fillReading(95n), signal)).resolves.toBeUndefined();
    await expect(readFill([there], fillReading(undefined), signal)).resolves.toBeUndefined();
  });

  it("finds none while no final block holds the fill", async () => {
    const { there } = readers();
    await expect(readFill([there], fillReading(95n), signal)).resolves.toBeUndefined();
    there.land(fillTx, { recipient, received: [{ asset: arrives, base: 95n }], final: false });
    await expect(readFill([there], fillReading(95n), signal)).resolves.toBeUndefined();
  });

  it("finds none under the least output when the route pays no coin in its place", async () => {
    const { there } = readers();
    there.land(fillTx, { recipient, received: [{ asset: arrives, base: 89n }] });
    await expect(readFill([there], fillReading(89n), signal)).resolves.toBeUndefined();
  });

  it("counts the coin a fill paid a plain wallet in place of the token, at least the least output", async () => {
    const { there } = readers();
    const asCoin = { ...bridge, deliveredAsCoin: coinThere };
    there.land(fillTx, { recipient, received: [{ asset: coinThere, base: 120n }] });
    await expect(readFill([there], fillReading(100n, asCoin), signal)).resolves.toStrictEqual({
      tx: fillTx,
      received: { asset: coinThere, base: 100n },
    });
    await expect(readFill([there], fillReading(80n, asCoin), signal)).resolves.toBeUndefined();
  });
});

describe("reading a bridge's refund (decision 0320)", () => {
  it("counts no more than the deposit sent, whatever else the transaction paid the wallet", async () => {
    const { here } = readers();
    here.land(refundTx, { recipient: wallet, received: [{ asset: sentToken, base: 500n }] });
    await expect(readRefund([here], refundReading(400n), signal)).resolves.toStrictEqual({
      tx: refundTx,
      received: { asset: sentToken, base: 100n },
    });
    await expect(readRefund([here], refundReading(40n), signal)).resolves.toStrictEqual({
      tx: refundTx,
      received: { asset: sentToken, base: 40n },
    });
  });

  it("finds none on another chain, with no reader, unowned, or paying nothing back", async () => {
    const { here, there } = readers();
    here.land(refundTx, { recipient: wallet, received: [{ asset: sentToken, base: 50n }] });
    await expect(readRefund([there], refundReading(50n, destination), signal)).resolves.toBe(
      undefined,
    );
    await expect(readRefund([there], refundReading(50n), signal)).resolves.toBeUndefined();
    await expect(readRefund([here], refundReading(undefined), signal)).resolves.toBeUndefined();
    await expect(readRefund([here], refundReading(0n), signal)).resolves.toBeUndefined();
    const { here: empty } = readers();
    await expect(readRefund([empty], refundReading(50n), signal)).resolves.toBeUndefined();
  });
});
