import {
  accountRefSchema,
  assetRefSchema,
  chainRefSchema,
  type DaySumsRefusal,
  type SignedTx,
  type Signer,
  type SignerLock,
  type SignOutcome,
  type SignRequest,
  type UnsignedTx,
} from "@binference/chain";
import { createEvmSigningScheme, encodeEvmTransaction } from "@binference/chain-evm";
import {
  signerContract,
  type SignerServiceControls,
  type SignerSubject,
} from "@binference/chain/testing";
import { type Clock, type Http, type Id, idSchema, type Random } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  makeServiceCertificates,
  type ServiceCertificates,
  serviceHttpOf,
} from "../contracts/signer-service-setup.js";
import type { PrivyId } from "../privy/privy-records.js";
import { oneBnbWei, testAddresses, testChain } from "../testing/custody-fixtures.js";
import { createFakeSignerBook, type FakeSignerBook } from "../testing/fake-signer-book.js";
import type { FakeServiceIntent, FakeServiceStep } from "../testing/fake-signer-checks.js";
import { type FakeSignerService, startFakeSignerService } from "../testing/fake-signer-service.js";
import { createPrivyServiceSigner, type ServiceRefusalNotice } from "./privy-service-signer.js";
import type { PrivyWallet } from "./privy-wallet.js";
import { decodeServiceRequest } from "./signer-service-wire.schema.js";

const dayMs = 86_400_000;
const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const install = idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001");
const termsHash = "0".repeat(64);
const chain = { ref: testChain.ref, chainId: testChain.chainId };
const unknownWallet = idSchema("wal").parse("wal_0190f1c2-3a4b-7c5d-8e6f-0000000000ff");
const call: FakeServiceStep = {
  to: testAddresses.router,
  value: oneBnbWei,
  data: "0x",
  does: { kind: "call" },
};

// TLS reads the certificates' validity from the machine's clock, so they start from it.
const certificates = makeServiceCertificates(Date.now());
const httpOf = (client: ServiceCertificates["worker"]): ReturnType<typeof serviceHttpOf> =>
  serviceHttpOf(certificates, client);
const { authority, worker, stranger } = certificates;
const serviceCertificate = certificates.service;

function unsignedOf(from: `0x${string}`, nonce = 0): UnsignedTx {
  const fees = { maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n };
  const sent = { to: testAddresses.router, value: oneBnbWei, data: "0x" } as const;
  return encodeEvmTransaction(testChain, { from, ...sent, nonce, gas: 90_000n, fees });
}

function idOf<P extends string>(prefix: P, count: number): Id<P> {
  const uuid = `0190f1c2-3a4b-7c5d-8e6f-${String(count).padStart(12, "0")}`;
  return idSchema(prefix).parse(`${prefix}_${uuid}`);
}

// Backoff waits come out near their cap, and ids differ from call to call.
function nearCapRandom(): Random {
  let calls = 0;
  return {
    bytes(length) {
      calls += 1;
      const bytes = new Uint8Array(length);
      bytes[0] = 0xff;
      new DataView(bytes.buffer).setUint16(length - 2, calls);
      return bytes;
    },
  };
}

/** A clock whose backoff waits, any wait shorter than an answer's 30 seconds, a test can await. */
interface WatchedClock {
  readonly clock: Clock;
  /** The backoff waits so far. */
  waits(): number;
  waitForWaits(count: number): Promise<void>;
}

function watched(manual: ManualClock): WatchedClock {
  let waits = 0;
  const waiters = new Set<{ readonly count: number; readonly resolve: () => void }>();
  const wake = (): void => {
    for (const waiter of [...waiters].filter(({ count }) => waits >= count)) {
      waiters.delete(waiter);
      waiter.resolve();
    }
  };
  return {
    clock: {
      now: () => manual.now(),
      sleep: async (delayMs, signal) => {
        const sleeping = manual.sleep(delayMs, signal);
        waits += delayMs < 30_000 ? 1 : 0;
        wake();
        return sleeping;
      },
    },
    waits: () => waits,
    waitForWaits: async (count) =>
      new Promise((resolve) => {
        waiters.add({ count, resolve });
        wake();
      }),
  };
}

function signedOf(outcome: SignOutcome): SignedTx {
  if (!outcome.ok) {
    throw new Error(`Not signed: ${outcome.error}`);
  }
  return outcome.value;
}

function lastOf<T>(items: readonly T[]): T {
  const item = items.at(-1);
  if (item === undefined) {
    throw new Error("Nothing yet.");
  }
  return item;
}

// Answers that name what this request did not ask about.
const otherRequest = { version: 1, requestId: "0190f1c2-3a4b-7c5d-8e6f-0000000000ee" } as const;
const otherChain = chainRefSchema.parse("eip155:97");
const otherChainSums = {
  chain: otherChain,
  asset: assetRefSchema.parse("eip155:97/slip44:714"),
  capBase: 1n,
  usedBase: 1n,
  askedBase: 1n,
  roomAtMs: 0,
} as const;
const otherChainTx = { chain: otherChain, raw: "0x00", hash: `0x${"0".repeat(64)}` } as const;

// The contract's requests name this intent and confirmation, which last until 2100.
const contractUuid = "0190f1c2-3b4c-7d5e-8f60-718293a4b5c6";
const contractEndMs = 4_102_444_800_000;

/** The contract's world: a fake service whose clock a sums check can move. */
interface ContractWorld {
  readonly book: FakeSignerBook;
  /** Sets the fake's database clock. */
  readonly at: (nowMs: number) => void;
}

// The service's own controls: a day already used up to the sums asked, or a lock.
function controlsOf(world: ContractWorld, address: string): SignerServiceControls {
  const { book } = world;
  return {
    fillSums(sums: DaySumsRefusal) {
      const reservedAtMs = sums.roomAtMs - dayMs;
      world.at(reservedAtMs);
      book.setDayCapUsd(sums.capBase / 10n ** 16n);
      const earlier = { nonce: 1, intent: idOf("int", 900), step: 0, tokenBase: 0n };
      book.plantReservation({
        ...earlier,
        account: address.toLowerCase(),
        nativeBase: sums.usedBase,
        reservedAtMs,
      });
    },
    lock(reason: SignerLock) {
      if (reason === "breaker") {
        book.pullBreaker();
        return;
      }
      book.lockKey(reason);
    },
  };
}

describe("privy-service signer, by the Signer contract", () => {
  // The contract names the native sum `slip44:1` on any chain.
  const asset = assetRefSchema.parse(`${testChain.ref}/slip44:1`);
  const native = { asset, baseUnitsPerUsd: 10n ** 16n };
  const wallet = idOf("wal", 1);
  let databaseNowMs = Date.now();
  const book = createFakeSignerBook({
    now: () => databaseNowMs,
    install,
    chain,
    native,
    tokens: [],
    maxUsd: 5_000n,
  });
  const world: ContractWorld = { book, at: (nowMs) => (databaseNowMs = nowMs) };
  const http = httpOf(worker);
  const random = nearCapRandom();
  let service: FakeSignerService;
  let current: PrivyWallet | undefined;
  beforeAll(async () => {
    const certificate = serviceCertificate;
    service = await startFakeSignerService({ certificate, workerAuthority: authority.cert, book });
  });
  afterAll(async () => {
    await http.close();
    await service.close();
  });

  const subject = (): SignerSubject & { readonly address: `0x${string}` } => {
    book.liftBreaker();
    book.lockKey(undefined);
    book.setDayCapUsd(1_000n);
    book.setLease({ worker: "w-1", fence: 7, expiresAtMs: contractEndMs + dayMs });
    const address = book.addWallet();
    current = { id: "wallet-1" as PrivyId, address, chains: [testChain.ref] };
    const authorization = {
      kind: "confirmation",
      id: idSchema("cnf").parse(`cnf_${contractUuid}`),
      expiresAtMs: contractEndMs,
    } as const;
    const intent = idSchema("int").parse(`int_${contractUuid}`);
    book.putIntent({
      id: intent,
      wallet: address,
      state: "executing",
      authorization,
      steps: [call],
    });
    const signer = createPrivyServiceSigner({
      http,
      origin: service.origin,
      lease: { install, fence: 7 },
      walletOf: (id) => (id === wallet ? current : undefined),
      clock: createManualClock(Date.now()),
      random,
      onRefusal: () => undefined,
    });
    return {
      signer,
      scheme: createEvmSigningScheme(),
      wallet,
      account: accountRefSchema.parse(`${testChain.ref}:${address}`),
      otherChain,
      unknownWallet,
      tx: unsignedOf(address),
      foreignTx: unsignedOf(testAddresses.unsaved),
      address,
    };
  };

  it.each(
    signerContract({
      create: subject,
      service: () => {
        const made = subject();
        return { ...made, controls: controlsOf(world, made.address) };
      },
    }),
  )("passes the Signer contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});

/** One intent the fake holds, and the wallet that signs it on both sides. */
interface Planned {
  readonly wallet: Id<"wal">;
  readonly address: `0x${string}`;
  readonly intent: Id<"int">;
  readonly confirmation: Id<"cnf">;
  readonly endMs: number;
}

function requestOf(planned: Planned, nonce = 0): SignRequest {
  const { wallet, intent, confirmation, endMs } = planned;
  const authorization = {
    kind: "confirmation",
    id: confirmation,
    intent,
    termsHash,
    expiresAtMs: endMs,
  } as const;
  return {
    wallet,
    intent,
    step: { index: 0, chain: testChain.ref, action: { kind: "call", nativeValue: oneBnbWei } },
    authorization,
    termsHash,
    allowed: { contracts: [], spenders: [], recipients: [] },
    tx: unsignedOf(planned.address, nonce),
  };
}

// The hash the wallet's scheme gives the signed transaction of the request.
function hashOf(request: SignRequest, signed: SignedTx): string {
  const verified = createEvmSigningScheme().verify(request.tx, signed);
  if (!verified.ok) {
    throw new Error(`Not the transaction asked: ${verified.error}`);
  }
  return verified.value.toLowerCase();
}

describe("privy-service signer, against the fake signer service", () => {
  const manual = createManualClock(Date.now());
  const watch = watched(manual);
  const book = createFakeSignerBook({
    now: () => manual.now(),
    install,
    chain,
    native: { asset: testChain.nativeAsset, baseUnitsPerUsd: 10n ** 16n },
    tokens: [],
    maxUsd: 5_000n,
  });
  const texts: string[] = [];
  const recording: FakeSignerBook = {
    ...book,
    answer: async (asked) => {
      texts.push(asked.text);
      return book.answer(asked);
    },
  };
  const wallets = new Map<Id<"wal">, PrivyWallet>();
  const refusals: ServiceRefusalNotice[] = [];
  const random = nearCapRandom();
  const https = [httpOf(worker), httpOf(stranger)] as const;
  let service: FakeSignerService;
  let made = 0;
  beforeAll(async () => {
    const certificate = serviceCertificate;
    const workerAuthority = authority.cert;
    service = await startFakeSignerService({ certificate, workerAuthority, book: recording });
  });
  beforeEach(() => {
    book.setLease({ worker: "w-1", fence: 7, expiresAtMs: manual.now() + 10 * dayMs });
    book.setDayCapUsd(1_000n);
    book.lockKey(undefined);
  });
  afterAll(async () => {
    await Promise.all(https.map(async (http) => http.close()));
    await service.close();
  });

  const signerFor = (http: Http = https[0]): Signer =>
    createPrivyServiceSigner({
      http,
      origin: service.origin,
      lease: { install, fence: 7 },
      walletOf: (id) => wallets.get(id),
      clock: watch.clock,
      random,
      onRefusal: (refused) => refusals.push(refused),
    });

  const plan = (
    steps: readonly FakeServiceStep[] = [call],
    more: Partial<FakeServiceIntent> & { readonly endMs?: number } = {},
  ): Planned => {
    made += 1;
    const address = book.addWallet();
    const wallet = idOf("wal", made);
    wallets.set(wallet, {
      id: `wallet-${String(made)}` as PrivyId,
      address,
      chains: [testChain.ref],
    });
    const intent = idOf("int", made);
    const confirmation = idOf("cnf", made);
    const endMs = more.endMs ?? manual.now() + 10 * 60_000;
    const authorization = { kind: "confirmation", id: confirmation, expiresAtMs: endMs } as const;
    book.putIntent({
      id: intent,
      wallet: address,
      state: "executing",
      authorization,
      steps,
      ...more,
    });
    return { wallet, address, intent, confirmation, endMs };
  };

  const signedTimes = (planned: Planned): readonly string[] =>
    book
      .reservations()
      .filter(({ account }) => account === planned.address.toLowerCase())
      .map(({ state }) => state);

  it("sends the step by name under the lease, never the transaction, its terms or its grant", async () => {
    const planned = plan();
    const request = requestOf(planned, 3);
    signedOf(await signerFor().signTransaction(request, live()));
    const sent = lastOf(texts);
    expect(decodeServiceRequest(sent)).toEqual({
      version: 1,
      requestId: lastOf(service.requests()).requestId,
      install,
      fence: 7,
      intent: planned.intent,
      step: 0,
      authorization: { kind: "confirmation", id: planned.confirmation },
      nonce: 3,
      gasLimit: 90_000n,
      fees: { maxFeePerGas: 10n ** 9n, maxPriorityFeePerGas: 10n ** 9n },
    });
    expect(sent).not.toContain(request.tx.payload.slice(2, 40));
    expect(sent).not.toContain(termsHash);
  });

  it("tells a refusal's reason, and reads unknown_wallet as the port's own", async () => {
    const broken = plan([{ ...call, breaks: "rule_2" }]);
    const outcome = await signerFor().signTransaction(requestOf(broken), live());
    expect(outcome).toEqual({ ok: false, error: "refused" });
    expect(lastOf(refusals)).toEqual({
      wallet: broken.wallet,
      intent: broken.intent,
      reason: "rule_2",
    });
    const unheld = plan([call], { wallet: testAddresses.saved });
    const unknown = await signerFor().signTransaction(requestOf(unheld), live());
    expect(unknown).toEqual({ ok: false, error: "unknown_wallet" });
    expect(lastOf(refusals).reason).toBe("unknown_wallet");
  });

  it("reads over_sums with the sum it would pass, and locked with why", async () => {
    book.setDayCapUsd(1n);
    const usedBase = book
      .reservations()
      .filter(({ state }) => state !== "released")
      .reduce((total, { nativeBase }) => total + nativeBase, 0n);
    const full = plan();
    expect(await signerFor().signTransaction(requestOf(full), live())).toEqual({
      ok: false,
      error: "over_sums",
      sums: {
        chain: testChain.ref,
        asset: testChain.nativeAsset,
        capBase: 10n ** 16n,
        usedBase,
        askedBase: oneBnbWei,
        roomAtMs: manual.now() + dayMs,
      },
    });
    book.setDayCapUsd(1_000n);
    book.lockKey("key_check");
    const locked = await signerFor().signTransaction(requestOf(plan()), live());
    expect(locked).toEqual({ ok: false, error: "locked", lock: "key_check" });
  });

  it("throws a lost lease and never asks again", async () => {
    const before = service.requests().length;
    book.setLease({ worker: "w-2", fence: 8, expiresAtMs: manual.now() + dayMs });
    const asking = signerFor().signTransaction(requestOf(plan()), live());
    await expect(asking).rejects.toMatchObject({ code: "store.lease_lost", retryable: false });
    expect(service.requests()).toHaveLength(before + 1);
  });

  it.each([
    { name: "down", event: { kind: "answer", outcome: { outcome: "down", reason: "kms" } } },
    { name: "a cut connection", event: { kind: "cut" } },
  ] as const)(
    "asks again with the same request id after $name, and signs once",
    async ({ event }) => {
      const planned = plan();
      const before = service.requests().length;
      const waits = watch.waits();
      service.next(event);
      const asking = signerFor().signTransaction(requestOf(planned), live());
      await watch.waitForWaits(waits + 1);
      await manual.advance(1_000);
      expect(hashOf(requestOf(planned), signedOf(await asking))).toMatch(/^0x[0-9a-f]{64}$/);
      const [first, second] = service.requests().slice(before);
      expect(second?.requestId).toBe(first?.requestId);
      expect(signedTimes(planned)).toEqual(["signed"]);
    },
  );

  it("asks again after no answer within 30 seconds, and takes the first answer", async () => {
    const planned = plan();
    const before = service.requests().length;
    const waits = watch.waits();
    service.next({ kind: "hang" });
    const asking = signerFor().signTransaction(requestOf(planned), live());
    await service.waitForRequests(before + 1);
    await manual.advance(30_000);
    await watch.waitForWaits(waits + 1);
    await manual.advance(1_000);
    signedOf(await asking);
    expect(
      service
        .requests()
        .slice(before)
        .map(({ requestId }) => requestId),
    ).toHaveLength(2);
    expect(signedTimes(planned)).toEqual(["signed"]);
  });

  it("never asks again once the step's authorization has ended", async () => {
    const before = service.requests().length;
    service.next({ kind: "answer", outcome: { outcome: "down", reason: "store" } });
    const ended = plan([call], { endMs: manual.now() });
    const asking = signerFor().signTransaction(requestOf(ended), live());
    await expect(asking).rejects.toMatchObject({ code: "custody.signer_down" });
    expect(service.requests()).toHaveLength(before + 1);
  });

  it.each([
    { name: "no JSON", event: { kind: "raw", status: 200, body: "signed" } },
    {
      name: "an unlisted status",
      event: { kind: "answer", status: 500, outcome: { outcome: "refused", reason: "rule_1" } },
    },
    {
      name: "down with 200",
      event: { kind: "answer", status: 200, outcome: { outcome: "down", reason: "kms" } },
    },
    {
      name: "lease_lost with 503",
      event: { kind: "answer", status: 503, outcome: { outcome: "lease_lost" } },
    },
    {
      name: "another request's id",
      event: {
        kind: "raw",
        status: 200,
        body: JSON.stringify({ ...otherRequest, outcome: "lease_lost" }),
      },
    },
    {
      name: "sums of another chain",
      event: { kind: "answer", outcome: { outcome: "over_sums", ...otherChainSums } },
    },
    {
      name: "a transaction of another chain",
      event: { kind: "answer", outcome: { outcome: "signed", tx: otherChainTx } },
    },
  ] as const)("reads $name as no answer, never as signed, and asks no more", async ({ event }) => {
    const before = service.requests().length;
    service.next(event);
    const asking = signerFor().signTransaction(requestOf(plan()), live());
    await expect(asking).rejects.toMatchObject({ code: "custody.service_answer_unread" });
    expect(service.requests()).toHaveLength(before + 1);
  });

  it("refuses a signed answer that is not the transaction asked, or names another hash", async () => {
    const planned = plan();
    const first = signedOf(await signerFor().signTransaction(requestOf(planned), live()));
    const tx = { chain: testChain.ref, raw: first.raw, hash: `0x${"0".repeat(64)}` };
    service.next({ kind: "answer", outcome: { outcome: "signed", tx } });
    const again = signerFor().signTransaction(requestOf(planned), live());
    await expect(again).rejects.toMatchObject({ code: "custody.service_answer_unread" });
    const hash = hashOf(requestOf(planned), first);
    service.next({ kind: "answer", outcome: { outcome: "signed", tx: { ...tx, hash } } });
    const other = signerFor().signTransaction(requestOf(planned, 1), live());
    await expect(other).rejects.toMatchObject({ code: "custody.signed_other_transaction" });
  });

  it("gets no answer with a certificate the service's authority did not sign", async () => {
    const before = service.requests().length;
    const ended = plan([call], { endMs: manual.now() });
    const asking = signerFor(https[1]).signTransaction(requestOf(ended), live());
    await expect(asking).rejects.toMatchObject({ code: "custody.signer_down" });
    expect(service.requests()).toHaveLength(before);
  });

  it("rejects with the signal's reason once it aborts mid-call, and hands nothing signed", async () => {
    const before = service.requests().length;
    service.next({ kind: "hang" });
    const stopping = new AbortController();
    const reason = new Error("stopped");
    const asking = signerFor().signTransaction(requestOf(plan()), { signal: stopping.signal });
    await service.waitForRequests(before + 1);
    stopping.abort(reason);
    await expect(asking).rejects.toBe(reason);
  });
});
