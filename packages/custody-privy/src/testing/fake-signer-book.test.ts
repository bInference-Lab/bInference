import { assetRefSchema } from "@binference/chain";
import { idSchema } from "@binference/core";
import { type Address, parseTransaction, recoverTransactionAddress } from "viem";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import {
  type SignerServiceAnswer,
  type SignerServiceRequest,
  signerServiceRequestSchema,
} from "../signing/signer-service-wire.schema.js";
import {
  approveData,
  oneBnbWei,
  testAddresses,
  testChain,
  transferData,
} from "./custody-fixtures.js";
import { createFakeSignerBook, type FakeAfterChecks } from "./fake-signer-book.js";
import type { FakeServiceIntent, FakeServiceStep } from "./fake-signer-checks.js";

const dayMs = 86_400_000;
const startMs = 1_800_000_000_000;
const install = idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const intent = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const other = idSchema("int").parse("int_0190f1c2-3a4b-7c5d-8e6f-000000000002");
const confirmation = idSchema("cnf").parse("cnf_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const native = { asset: testChain.nativeAsset, baseUnitsPerUsd: 10n ** 16n };
const token = assetRefSchema.parse(`${testChain.ref}/erc20:${testAddresses.token.toLowerCase()}`);
const unlisted = assetRefSchema.parse(
  `${testChain.ref}/erc20:${testAddresses.unlisted.toLowerCase()}`,
);

const call = (value: bigint): FakeServiceStep => ({
  to: testAddresses.router,
  value,
  data: "0x",
  does: { kind: "call" },
});
const coinSend = (to: Address, value: bigint): FakeServiceStep => ({
  to,
  value,
  data: "0x",
  does: { kind: "send", recipient: to },
});
const tokenSend: FakeServiceStep = {
  to: testAddresses.token,
  value: 0n,
  data: transferData(testAddresses.saved, 10n ** 24n),
  does: { kind: "send", recipient: testAddresses.saved },
};
const approval = (asset: typeof token, amountBase: bigint): FakeServiceStep => ({
  to: testAddresses.token,
  value: 0n,
  data: approveData(testAddresses.router, amountBase),
  does: { kind: "approve", token: asset, amountBase },
});

function world() {
  let nowMs = startMs;
  let ids = 0;
  const book = createFakeSignerBook({
    now: () => nowMs,
    install,
    chain: { ref: testChain.ref, chainId: testChain.chainId },
    native,
    tokens: [{ asset: token, baseUnitsPerUsd: 10n ** 18n }],
    maxUsd: 5_000n,
  });
  const wallet = book.addWallet();
  book.setLease({ worker: "w-1", fence: 7, expiresAtMs: startMs + 10 * dayMs });
  book.setRescue(testAddresses.rescue);
  const plan = (steps: readonly FakeServiceStep[], more: Partial<FakeServiceIntent> = {}): void => {
    const authorization = {
      kind: "confirmation",
      id: confirmation,
      expiresAtMs: nowMs + 60_000,
    } as const;
    book.putIntent({ id: intent, wallet, state: "executing", authorization, steps, ...more });
  };
  const ask = async (
    asked: Partial<SignerServiceRequest> = {},
    more: {
      readonly worker?: string;
      readonly after?: FakeAfterChecks;
      readonly requestId?: string;
    } = {},
  ): Promise<SignerServiceAnswer> => {
    ids += 1;
    const request: SignerServiceRequest = {
      version: 1,
      requestId: more.requestId ?? `0190f1c2-3a4b-7c5d-8e6f-${String(ids).padStart(12, "0")}`,
      install,
      fence: 7,
      intent,
      step: 0,
      authorization: { kind: "confirmation", id: confirmation },
      nonce: 0,
      gasLimit: 90_000n,
      fees: { maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n },
      ...asked,
    };
    const text = JSON.stringify(z.encode(signerServiceRequestSchema, request));
    const after = more.after === undefined ? {} : { after: more.after };
    return book.answer({ worker: more.worker ?? "w-1", text, request, ...after });
  };
  return { book, wallet, plan, ask, at: (ms: number) => (nowMs = ms) };
}

function rawOf(answer: SignerServiceAnswer): `0x02${string}` {
  if (answer.outcome !== "signed") {
    throw new Error(`Not signed: ${answer.outcome}`);
  }
  return answer.tx.raw as `0x02${string}`;
}

const outcome = (answer: SignerServiceAnswer): string =>
  answer.outcome === "refused" || answer.outcome === "locked"
    ? `${answer.outcome}:${answer.reason}`
    : answer.outcome;

describe("the fake signer service's book", () => {
  it("signs the plan's call at the worker's nonce, gas and fees, with the wallet's key", async () => {
    const { plan, ask, wallet } = world();
    plan([call(oneBnbWei)]);
    const raw = rawOf(await ask({ nonce: 4 }));
    expect(parseTransaction(raw)).toMatchObject({
      to: testAddresses.router.toLowerCase(),
      value: oneBnbWei,
      nonce: 4,
      gas: 90_000n,
      chainId: 56,
    });
    expect(await recoverTransactionAddress({ serializedTransaction: raw })).toBe(wallet);
  });

  it("answers a repeat its first answer for a day, and the same id with another body malformed", async () => {
    const { plan, ask, at } = world();
    plan([call(1n)]);
    const requestId = "0190f1c2-3a4b-7c5d-8e6f-0000000000aa";
    const first = await ask({}, { requestId });
    expect(await ask({}, { requestId })).toEqual(first);
    expect(outcome(await ask({ nonce: 9 }, { requestId }))).toBe("refused:malformed");
    at(startMs + dayMs);
    plan([call(1n)]);
    expect(outcome(await ask({ nonce: 9 }, { requestId }))).toBe("signed");
  });

  it("refuses a call past the native sum with the cap, the use and when room frees", async () => {
    const { book, plan, ask, at, wallet } = world();
    const oldMs = startMs - dayMs + 1_000;
    book.plantReservation({
      account: wallet.toLowerCase(),
      nonce: 0,
      intent: other,
      step: 0,
      nativeBase: 6n * oneBnbWei,
      tokenBase: 0n,
      reservedAtMs: oldMs,
    });
    book.plantReservation({
      account: wallet.toLowerCase(),
      nonce: 1,
      intent: other,
      step: 1,
      nativeBase: 3n * oneBnbWei,
      tokenBase: 0n,
      reservedAtMs: startMs - 1_000,
    });
    plan([call(2n * oneBnbWei)]);
    expect(await ask({ nonce: 2 })).toMatchObject({
      outcome: "over_sums",
      asset: native.asset,
      capBase: 10n * oneBnbWei,
      usedBase: 9n * oneBnbWei,
      askedBase: 2n * oneBnbWei,
      roomAtMs: oldMs + dayMs,
    });
    expect(book.reservations()).toHaveLength(2);
    at(oldMs + dayMs);
    expect(outcome(await ask({ nonce: 2 }))).toBe("signed");
  });

  it("never refuses a send but counts a coin send's value, and a cancel or a token send nothing", async () => {
    const { book, plan, ask, wallet } = world();
    book.plantReservation({
      account: wallet.toLowerCase(),
      nonce: 0,
      intent: other,
      step: 0,
      nativeBase: 10n * oneBnbWei,
      tokenBase: 0n,
      reservedAtMs: startMs,
    });
    plan([coinSend(testAddresses.saved, 2n * oneBnbWei), tokenSend]);
    expect(outcome(await ask({ nonce: 1 }))).toBe("signed");
    expect(outcome(await ask({ nonce: 1, replaces: "cancel" }))).toBe("signed");
    expect(outcome(await ask({ nonce: 2, step: 1 }))).toBe("signed");
    const counted = book.reservations().map(({ nativeBase, tokenBase }) => [nativeBase, tokenBase]);
    expect(counted).toEqual([
      [10n * oneBnbWei, 0n],
      [2n * oneBnbWei, 0n],
      [0n, 0n],
    ]);
  });

  it("counts an approval of a capped token against its sum, and of another token nothing", async () => {
    const { book, plan, ask } = world();
    book.setDayCapUsd(100_000n);
    plan([
      approval(token, 4_000n * 10n ** 18n),
      approval(token, 2_000n * 10n ** 18n),
      approval(unlisted, 10n ** 30n),
    ]);
    expect(outcome(await ask({ nonce: 0 }))).toBe("signed");
    expect(await ask({ nonce: 1, step: 1 })).toMatchObject({
      outcome: "over_sums",
      asset: token,
      capBase: 5_000n * 10n ** 18n,
    });
    expect(outcome(await ask({ nonce: 1, step: 2 }))).toBe("signed");
    expect(book.reservations().map(({ tokenBase }) => tokenBase)).toEqual([
      4_000n * 10n ** 18n,
      0n,
    ]);
  });

  it("holds a nonce for the intent that has not ended, and lets its own replacement grow it", async () => {
    const { book, plan, ask, wallet } = world();
    plan([call(oneBnbWei)]);
    expect(outcome(await ask({ nonce: 3, replaces: "speedUp" }))).toBe("refused:rule_6");
    expect(outcome(await ask({ nonce: 3 }))).toBe("signed");
    expect(outcome(await ask({ nonce: 3, replaces: "speedUp", gasLimit: 95_000n }))).toBe("signed");
    expect(book.reservations()).toHaveLength(1);
    const authorization = {
      kind: "confirmation",
      id: confirmation,
      expiresAtMs: startMs + 60_000,
    } as const;
    const holder = {
      id: intent,
      wallet,
      state: "executing",
      authorization,
      steps: [call(oneBnbWei)],
    } as const;
    book.putIntent({ ...holder, id: other });
    expect(outcome(await ask({ nonce: 3, intent: other }))).toBe("refused:nonce_held");
    book.putIntent({ ...holder, state: "ended" });
    expect(outcome(await ask({ nonce: 3, intent: other }))).toBe("signed");
    expect(book.reservations()).toHaveLength(2);
  });

  it("keeps a pulled breaker's rescues: only a rescue's send to the rescue address signs", async () => {
    const { book, plan, ask } = world();
    book.pullBreaker();
    plan([call(1n)]);
    expect(outcome(await ask())).toBe("locked:breaker");
    plan([coinSend(testAddresses.saved, 1n)], { isRescue: true });
    expect(outcome(await ask())).toBe("locked:breaker");
    plan([coinSend(testAddresses.rescue, 1n)], { isRescue: true });
    expect(outcome(await ask())).toBe("signed");
    book.lockKey("key_check");
    expect(outcome(await ask({ nonce: 1 }))).toBe("locked:key_check");
  });

  it("answers lease_lost to a worker without the lease, or one that lost it as it signed", async () => {
    const { book, plan, ask } = world();
    plan([call(1n)]);
    expect(outcome(await ask({}, { worker: "w-2" }))).toBe("lease_lost");
    expect(outcome(await ask({ fence: 6 }))).toBe("lease_lost");
    expect(outcome(await ask({}, { after: "lease_lost_after_sign" }))).toBe("lease_lost");
    expect(outcome(await ask({}, { after: "privy_refuses" }))).toBe("refused:privy_refused");
    expect(outcome(await ask({}, { after: "privy_app" }))).toBe("locked:privy_app");
    expect(book.reservations().map(({ state }) => state)).toEqual(Array(3).fill("released"));
    book.setLease(undefined);
    expect(outcome(await ask())).toBe("lease_lost");
  });

  it("reads the authorization and the intent from its own rows", async () => {
    const { plan, ask, at } = world();
    plan([{ ...call(1n), breaks: "rule_2" }, call(1n)]);
    expect(outcome(await ask())).toBe("refused:rule_2");
    expect(outcome(await ask({ step: 1, authorization: { kind: "approvalMode" } }))).toBe(
      "refused:no_authorization",
    );
    expect(outcome(await ask({ step: 1, nonce: 1 }))).toBe("signed");
    at(startMs + 60_000);
    expect(outcome(await ask({ step: 1, nonce: 2 }))).toBe("refused:authorization_ended");
    expect(outcome(await ask({ step: 1, nonce: 1, replaces: "cancel" }))).toBe("signed");
    plan([call(1n)], { state: "ended" });
    expect(outcome(await ask({ nonce: 5 }))).toBe("refused:intent_state");
  });
});
