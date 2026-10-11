import { accountRefSchema, type TxHash } from "@binference/chain";
import { createFakeNonceSource } from "@binference/chain/testing";
import { BinferenceError } from "@binference/core";
import { createManualClock } from "@binference/core/testing";
import { describe, expect, it } from "vitest";
import { fixtureId } from "../contracts/store-fixtures.js";
import { createMemoryTransactionStore } from "../fakes/memory-transaction-store.js";
import type { SignedTransaction } from "./transaction-record.js";
import { openWalletSlot } from "./wallet-slot.js";

const account = accountRefSchema.parse("fake:1:0x0000000a");
const other = accountRefSchema.parse("fake:1:0x0000000b");
const live = { signal: new AbortController().signal };

function signed(n: number, nonce: number): SignedTransaction {
  return {
    id: fixtureId("tx", n),
    intentId: fixtureId("int", n),
    step: 0,
    account,
    nonce,
    raw: `0x02f8${n.toString(16)}`,
    hash: `0x${n.toString(16).padStart(64, "0")}` as TxHash,
    signedAtMs: 5_000,
  };
}

function setUp() {
  const transactions = createMemoryTransactionStore();
  const nonces = createFakeNonceSource(new Map([[account, 7]]));
  const clock = createManualClock(5_000);
  return { transactions, nonces, ...openWalletSlot(account, { transactions, nonces, clock }) };
}

const notGiven = { code: "wallet_queue.not_given" };

describe("a wallet slot", () => {
  it("gives the lowest free nonce from the chain's count read at that moment", async () => {
    const { slot, nonces } = setUp();
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 7, refillsGap: false });
    nonces.set(account, 9);
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 9, refillsGap: false });
    await expect(slot.saveSigned(signed(1, 9), live)).resolves.toMatchObject({ ok: true });
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 10, refillsGap: false });
  });

  it("stores a signed transaction only at the account and nonce it was given", async () => {
    const { slot, transactions } = setUp();
    await expect(slot.saveSigned(signed(1, 7), live)).rejects.toMatchObject(notGiven);
    await slot.nextNonce(live);
    await expect(slot.saveSigned(signed(1, 8), live)).rejects.toMatchObject({
      ...notGiven,
      details: { account, nonce: 8, intent: fixtureId("int", 1) },
    });
    await expect(slot.saveSigned({ ...signed(1, 7), account: other }, live)).rejects.toMatchObject(
      notGiven,
    );
    await expect(slot.saveSigned(signed(1, 7), live)).resolves.toStrictEqual({
      ok: true,
      value: { ...signed(1, 7), state: "signed" },
    });
    await expect(slot.saveSigned(signed(2, 7), live)).rejects.toMatchObject(notGiven);
    await expect(
      transactions.list({ account, fromNonce: 0, limit: 10 }, live),
    ).resolves.toHaveLength(1);
  });

  it("passes on a nonce the store finds taken, and needs a new nonce after it", async () => {
    const { slot, transactions } = setUp();
    await slot.nextNonce(live);
    await transactions.saveSigned(signed(9, 7), live);
    await expect(slot.saveSigned(signed(1, 7), live)).resolves.toStrictEqual({
      ok: false,
      error: "nonce_taken",
    });
    await expect(slot.saveSigned(signed(1, 7), live)).rejects.toMatchObject(notGiven);
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 8, refillsGap: false });
  });

  it("refuses a pending count past the mined one that no stored transaction explains", async () => {
    const transactions = createMemoryTransactionStore();
    const ahead = { next: async () => Promise.resolve(9), mined: async () => Promise.resolve(7) };
    const { slot } = openWalletSlot(account, {
      transactions,
      nonces: ahead,
      clock: createManualClock(5_000),
    });
    await expect(slot.nextNonce(live)).rejects.toMatchObject({
      code: "wallet_queue.nonce_ahead",
      details: { pending: 9, mined: 7 },
    });
    await transactions.nextNonce({ account, chainNonce: 7, atMs: 1 }, live);
    await transactions.saveSigned(signed(1, 7), live);
    await expect(slot.nextNonce(live)).rejects.toMatchObject({ code: "wallet_queue.nonce_ahead" });
    await transactions.nextNonce({ account, chainNonce: 8, atMs: 1 }, live);
    await transactions.saveSigned(signed(2, 8), live);
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 9, refillsGap: false });
  });

  it("refuses a pending count more than a full queue past the mined one", async () => {
    const far = { next: async () => Promise.resolve(108), mined: async () => Promise.resolve(7) };
    const { slot } = openWalletSlot(account, {
      transactions: createMemoryTransactionStore(),
      nonces: far,
      clock: createManualClock(5_000),
    });
    await expect(slot.nextNonce(live)).rejects.toMatchObject({ code: "wallet_queue.nonce_ahead" });
  });

  it("asks the store for nothing when the chain gives no count", async () => {
    const { slot, transactions } = setUp();
    const down = new BinferenceError({ code: "chain.rpc_down", message: "no node answered" });
    const failing = openWalletSlot(account, {
      transactions,
      nonces: { next: async () => Promise.reject(down), mined: async () => Promise.reject(down) },
      clock: createManualClock(),
    });
    await expect(failing.slot.nextNonce(live)).rejects.toBe(down);
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 7, refillsGap: false });
  });

  it("stores a replacement of its account's transaction at that nonce, taking none", async () => {
    const { slot, transactions } = setUp();
    await slot.nextNonce(live);
    await slot.saveSigned(signed(1, 7), live);
    const speedUp = {
      ...signed(2, 7),
      intentId: fixtureId("int", 1),
      replaces: { id: fixtureId("tx", 1), kind: "speedUp" },
    } as const;
    await expect(slot.saveReplacement({ ...speedUp, account: other }, live)).rejects.toMatchObject(
      notGiven,
    );
    await expect(slot.saveReplacement(speedUp, live)).resolves.toStrictEqual({
      ok: true,
      value: { ...speedUp, state: "signed" },
    });
    const stored = await transactions.ofIntent(fixtureId("int", 1), live);
    expect(stored.map(({ state }) => state)).toStrictEqual(["superseded", "signed"]);
    await expect(slot.nextNonce(live)).resolves.toStrictEqual({ nonce: 8, refillsGap: false });
  });

  it("refuses every use once it is closed", async () => {
    const opened = setUp();
    await opened.slot.nextNonce(live);
    opened.close();
    const { slot } = opened;
    const closed = { code: "wallet_queue.slot_closed", details: { account } };
    await expect(slot.nextNonce(live)).rejects.toMatchObject(closed);
    await expect(slot.saveSigned(signed(1, 7), live)).rejects.toMatchObject(closed);
    const replaces = { id: fixtureId("tx", 1), kind: "cancel" } as const;
    const replacement = { ...signed(2, 7), replaces };
    await expect(slot.saveReplacement(replacement, live)).rejects.toMatchObject(closed);
  });

  it("rejects with the signal's reason once the signal aborts", async () => {
    const { slot } = setUp();
    const reason = new Error("stopped");
    await expect(slot.nextNonce({ signal: AbortSignal.abort(reason) })).rejects.toBe(reason);
    await slot.nextNonce(live);
    await expect(slot.saveSigned(signed(1, 7), { signal: AbortSignal.abort(reason) })).rejects.toBe(
      reason,
    );
  });
});
