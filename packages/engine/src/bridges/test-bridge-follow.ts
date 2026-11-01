import {
  type AccountRef,
  accountRefParts,
  type Amount,
  type Bridge,
  type DeliveryReader,
  type DepositRef,
  isTxHash,
  type TxHash,
} from "@binference/chain";
import {
  createFakeBridge,
  createFakeDeliveryReader,
  createFakeSigner,
  type FakeBridge,
} from "@binference/chain/testing";
import { createIdSource, type Id, type IdSource } from "@binference/core";
import {
  createManualClock,
  createMemoryLogger,
  createSeededRandom,
} from "@binference/core/testing";
import type { BridgeRequest, IntentState } from "@binference/protocol";
import { z } from "zod";
import type { DestinationChain } from "../address-book/destination-chain.js";
import { createFakePriceSource } from "../fakes/fake-price-source.js";
import {
  createMemoryEngineStores,
  type MemoryEngineStores,
} from "../fakes/memory-engine-stores.js";
import { createMemoryPositionStore } from "../fakes/memory-position-store.js";
import { bridgeQuoteDocument } from "../intents/bridge-quote.js";
import { createStoredIntents } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import {
  testAgent,
  testAgentDraft,
  testNowMs,
  testToken,
  testWallet,
} from "../intents/test-intents.js";
import { testAccount, testChains } from "../operations/test-engine.js";
import { createPositions } from "../positions/create-positions.js";
import type { EnginePush } from "../pushes/engine-push.js";
import { bridgeReceiptOf } from "../surfaces/bridge-receipt.js";
import type { LiveReceipt } from "../surfaces/live-receipt.js";
import type { BridgeDeliveryState } from "./bridge-record.js";
import { createBridgeFollower } from "./follow-bridges.js";

/** A notice the follower published: its key and its plain values. */
interface FollowedNotice {
  readonly key: string;
  readonly values: Readonly<Record<string, string>>;
}

/** A follower over one bridge in transit, whose delivery a test's readers read. */
export interface BridgeFollowBench {
  /** Runs one pass of the follower. */
  follow(): Promise<void>;
  /** Moves the bench's clock on, as time passes between passes. */
  advance(ms: number): Promise<void>;
  /** The bridge intent's state and its bridge's, as stored now. */
  states(): Promise<readonly [IntentState | undefined, BridgeDeliveryState | undefined]>;
  /** The notices the follower published, oldest first. */
  notices(): readonly FollowedNotice[];
  /** What the follower logged, oldest first: each record's event and error code. */
  logged(): readonly (readonly [string, string | undefined])[];
  /** The bridge's receipt as the owner's surfaces show it, read with the chains given. */
  receipt(destinations: readonly DestinationChain[]): Promise<LiveReceipt | undefined>;
}

const live = { signal: new AbortController().signal };
const noticeSchema = z.object({ key: z.string(), values: z.record(z.string(), z.string()) });

function depositHash(): TxHash {
  const hash = `0x${"d1".repeat(32)}`;
  if (!isTxHash(hash)) {
    throw new Error("Expected a hash.");
  }
  return hash;
}

/** The deposit a bench's bridge sent: its transaction, what it sent, and the wallet's account. */
interface FollowedDeposit {
  readonly hash: TxHash;
  readonly sent: Amount;
  readonly wallet: AccountRef;
}

/** What the bench's bridge delivers and where the venue says its fill landed. */
interface FollowedBridge {
  readonly recipient: AccountRef;
  readonly minOut: Amount;
  readonly fill: DepositRef;
  /** The deposit; 100 of the fake token from the test account on the fake chain when absent. */
  readonly deposit?: FollowedDeposit;
  /** The fake chain's deposit's transaction, when the deposit is the default one. */
  readonly depositHash?: TxHash;
  /** The venue; the fake bridge, which takes a fill as its own when its events name the deposit. */
  readonly bridge?: Bridge;
  /** The destination's name as the confirmed quote holds it; its chain's id when absent. */
  readonly chainName?: string;
}

// The quote a card would have confirmed: the amount, the recipient and the least output.
function quoteOf(given: FollowedBridge & { readonly venue: string }, amount: Amount) {
  return bridgeQuoteDocument.encode({
    venue: given.venue,
    chainName: given.chainName ?? accountRefParts(given.recipient).chain,
    amount,
    recipient: given.recipient,
    recipientBytes: "0x01",
    expectedOut: given.minOut,
    minOut: given.minOut,
    fees: [],
    etaSeconds: 2,
    quotedAtMs: testNowMs,
    expiresAtMs: testNowMs + 60_000,
    deposit: { kind: "bound", contract: given.recipient, destinationId: "1" },
  });
}

// The bridge intent, final, of the deposit's amount to the recipient, which must deliver at least
// the least output; and its bridge in transit. Answers the intent's id.
async function storeFinalBridge(
  stores: MemoryEngineStores,
  ids: IdSource,
  given: FollowedBridge & { readonly venue: string; readonly deposit: FollowedDeposit },
): Promise<Id<"int">> {
  const intentId = ids.next("int");
  const amount = given.deposit.sent;
  const toChain = accountRefParts(given.recipient).chain;
  const quote = quoteOf(given, amount);
  const request: BridgeRequest = {
    kind: "bridge",
    agent: testAgent,
    reason: "Move to the exchange",
    amount,
    toChain,
    to: { rescue: true },
  };
  await stores.intents.create(
    {
      id: intentId,
      agentId: testAgent,
      walletId: testWallet,
      kind: "bridge",
      state: "finalized",
      quote,
      request: requestDocument.encode(request),
      hasOutsideContent: false,
      isPaper: false,
      proposer: "engine",
      atMs: testNowMs,
      cause: { proposer: "owner" },
    },
    live,
  );
  const depositTx = given.deposit.hash;
  const { recipient, minOut, venue } = given;
  const opening = { intentId, venue, depositTx, toChain, recipient };
  await stores.bridges.open({ ...opening, sent: amount, minOut, sentAtMs: testNowMs }, live);
  return intentId;
}

// The deposit the bench follows, and a reader of its chain when it is the fake chain's default.
function depositOf(given: FollowedBridge): {
  readonly deposit: FollowedDeposit;
  readonly readers: readonly DeliveryReader[];
} {
  if (given.deposit !== undefined) {
    return { deposit: given.deposit, readers: [] };
  }
  const deposit = {
    hash: given.depositHash ?? depositHash(),
    sent: { asset: testToken, base: 100_000_000n },
    wallet: testAccount,
  };
  const source = createFakeDeliveryReader(accountRefParts(testAccount).chain);
  source.land(deposit.hash, { recipient: testAccount, received: [] });
  return { deposit, readers: [source] };
}

// The fake bridge with its status naming the fill of the deposit.
function settledFake(fill: DepositRef, deposit: FollowedDeposit): FakeBridge {
  const fake = createFakeBridge({ routes: [] });
  fake.settle(deposit.hash, { kind: "filled", fill });
  return fake;
}

// The bridge's receipt as the owner's surfaces read it, with the chains bridges deliver to.
async function receiptOf(
  stores: MemoryEngineStores,
  intentId: Id<"int">,
  destinations: readonly DestinationChain[],
): Promise<LiveReceipt | undefined> {
  const record = await stores.intents.get(intentId, live);
  const reads = { ...stores, chains: testChains(), destinations };
  return record === undefined ? undefined : bridgeReceiptOf({ ...reads, record }, live);
}

/**
 * Starts the follower over one live bridge, final and in transit, to `recipient` on its chain,
 * which must deliver at least `minOut`: by default 100 of the fake token deposited on the fake chain
 * through the fake bridge, whose status names `fill` and which takes it as its own when its events
 * name the deposit; or the given deposit through the given bridge. `readers` read the chains. For
 * a test of the chain families' delivery readers, and of a bridge's match, on recorded answers.
 */
export async function startBridgeFollowBench(
  given: FollowedBridge & { readonly readers: readonly DeliveryReader[] },
): Promise<BridgeFollowBench> {
  const clock = createManualClock(testNowMs);
  const stores = createMemoryEngineStores();
  const pushes: EnginePush[] = [];
  const publish = (push: EnginePush): void => {
    pushes.push(push);
  };
  await stores.agents.create(testAgentDraft({ mode: "live" }), live);
  const ids = createIdSource({ clock, random: createSeededRandom(11) });
  const { deposit, readers } = depositOf(given);
  const bridge = given.bridge ?? settledFake(given.fill, deposit);
  const intentId = await storeFinalBridge(stores, ids, { ...given, venue: bridge.id, deposit });
  const positions = createMemoryPositionStore();
  const log = createMemoryLogger({ subsystem: "bridges" });
  const follower = createBridgeFollower({
    bridges: stores.bridges,
    stored: createStoredIntents({ intents: stores.intents, agents: stores.agents, ids, publish }),
    hosted: [{ bridge, routes: [] }],
    readers: [...readers, ...given.readers],
    custody: createFakeSigner(new Map([[testWallet, deposit.wallet]])),
    positions: createPositions({ store: positions, prices: createFakePriceSource(new Map()) }),
    positionStore: positions,
    install: stores.install,
    chains: testChains(),
    publish,
    clock,
    log,
  });
  return {
    follow: async () => follower.follow(live),
    advance: async (ms) => clock.advance(ms),
    async states() {
      const record = await stores.intents.get(intentId, live);
      const held = await stores.bridges.get(intentId, live);
      return [record?.state, held?.state];
    },
    notices: () =>
      pushes.flatMap((push) => {
        const notice = noticeSchema.safeParse(push.data);
        return push.kind === "notice/new" && notice.success ? [notice.data] : [];
      }),
    logged: () => log.records().map((record) => [record.event, record.fields.errorCode] as const),
    receipt: async (destinations) => receiptOf(stores, intentId, destinations),
  };
}
