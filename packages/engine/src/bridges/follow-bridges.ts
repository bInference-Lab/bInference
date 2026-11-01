import {
  type AccountRef,
  assetRefParts,
  type Bridge,
  type ChainRegistry,
  type DeliveryReader,
  type DepositStatus,
  type Signer,
} from "@binference/chain";
import { BinferenceError, type Clock, type Logger } from "@binference/core";
import { type BridgeIntentQuote, bridgeQuoteDocument } from "../intents/bridge-quote.js";
import type { IntentSnapshot, StoredIntents } from "../intents/create-stored-intents.js";
import { createIntentStateMachine } from "../intents/state-machine.js";
import type { InstallStore, PositionStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { noticePush } from "../pushes/notice-push.js";
import type { BridgeCursor, BridgeMove, BridgeRecord } from "./bridge-record.js";
import { openBridgeStates } from "./bridge-record.js";
import {
  bridgeAssetsOf,
  bridgeLateAfterMs,
  recordRefund,
  tellSettled,
} from "./bridge-settlement.js";
import type { HostedBridge } from "./hosted-bridge.js";
import type { BridgeStore } from "./ports.js";
import {
  readDeposit,
  readFill,
  readRefund,
  type ReadSettlement,
  type SettlementReading,
} from "./read-delivery.js";
import { createStatusReads, type StatusReads } from "./read-status.js";

/** What the delivery of each bridge in transit is followed through (decision 0297). */
export interface BridgeFollowParts {
  readonly bridges: BridgeStore;
  readonly stored: StoredIntents;
  readonly hosted: readonly HostedBridge[];
  /** The delivery readers of the chains bridges deliver to and of the chains they leave from. */
  readonly readers: readonly DeliveryReader[];
  readonly custody: Pick<Signer, "account">;
  readonly positions: Pick<Positions, "receive">;
  readonly positionStore: Pick<PositionStore, "arrivals">;
  readonly install: Pick<InstallStore, "read">;
  readonly chains: ChainRegistry;
  readonly publish: PublishPush;
  readonly clock: Clock;
  /** Where a status read that fails is logged by its code; nothing is logged without it. */
  readonly log?: Logger;
}

/** The follower's parts with its status reads, which remember each venue across passes. */
type Following = BridgeFollowParts & { readonly reads: StatusReads };

/** One bridge followed: its row, its intent and the quote its card confirmed. */
interface Followed {
  readonly bridge: BridgeRecord;
  readonly snapshot: IntentSnapshot;
  readonly quote: BridgeIntentQuote;
}

// How many bridges in transit one pass reads.
const passLimit = 100;

function intentChanged(parts: BridgeFollowParts, snapshot: IntentSnapshot): void {
  const { record } = snapshot;
  parts.publish({
    topic: "intent",
    kind: "intent/changed",
    data: {
      intent: record.id,
      agent: record.agentId,
      state: record.state,
      version: record.version,
      changedAt: record.changedAtMs,
    },
  });
}

// Two hours after its deposit is final, a bridge in transit is marked late once, and the owner told
// once with the venue's page for it, whether or not the venue said where it stands: only the
// writer whose move landed tells (decision 0297).
async function markLate(
  parts: BridgeFollowParts,
  followed: Followed,
  call: { readonly statusUrl: string; readonly signal: AbortSignal },
): Promise<void> {
  const { bridge, snapshot, quote } = followed;
  const atMs = parts.clock.now();
  if (bridge.state !== "in_transit" || atMs < bridge.sentAtMs + bridgeLateAfterMs) {
    return;
  }
  const move = {
    intentId: bridge.intentId,
    expectedVersion: bridge.version,
    atMs,
    to: "late",
  } as const;
  const moved = await parts.bridges.move(move, { signal: call.signal });
  if (!moved.ok) {
    return;
  }
  const { record } = snapshot;
  const values = { chain: quote.chainName, venue: quote.venue, statusUrl: call.statusUrl };
  parts.publish(
    noticePush({
      key: "notice.bridgeLate",
      agent: record.agentId,
      intent: record.id,
      values,
      amounts: { amount: quote.amount },
      assets: bridgeAssetsOf(parts.chains, snapshot, quote),
    }),
  );
  intentChanged(parts, snapshot);
}

// The wallet that deposited, on the chain the deposit left from.
async function walletOf(
  parts: BridgeFollowParts,
  followed: Followed,
  signal: AbortSignal,
): Promise<AccountRef | undefined> {
  const chain = assetRefParts(followed.bridge.sent.asset).chain;
  const wallet = await parts.custody.account(followed.snapshot.record.walletId, chain, { signal });
  return wallet.ok ? wallet.value : undefined;
}

// What a read of the chain says of the bridge's state by its venue's word, matched to this
// deposit by the venue's own events (decision 0320): a fill read on its own destination chain, or
// a refund read on its source chain; none otherwise, or while the deposit's own read is not final.
async function readSettlement(
  parts: BridgeFollowParts,
  followed: Followed & { readonly venue: Pick<Bridge, "settlement"> },
  call: { readonly status: DepositStatus; readonly signal: AbortSignal },
): Promise<{ readonly to: "delivered" | "refunded"; readonly read: ReadSettlement } | undefined> {
  const { bridge, venue } = followed;
  const { state } = call.status;
  const { signal } = call;
  if (state.kind !== "filled" && state.kind !== "refunded") {
    return undefined;
  }
  const wallet = await walletOf(parts, followed, signal);
  const deposit =
    wallet === undefined ? undefined : await readDeposit(parts.readers, { bridge, wallet }, signal);
  if (wallet === undefined || deposit === undefined) {
    return undefined;
  }
  const reading: SettlementReading = { bridge, venue, deposit, wallet };
  if (state.kind === "filled") {
    const read = await readFill(parts.readers, { ...reading, fill: state.fill }, signal);
    return read === undefined ? undefined : { to: "delivered", read };
  }
  const read = await readRefund(parts.readers, { ...reading, refund: state.refund }, signal);
  return read === undefined ? undefined : { to: "refunded", read };
}

// Settles the bridge as the read found it (decision 0320): a transaction another bridge holds
// settles nothing; a refund's units arrive first, once by its transaction, then the row moves,
// then the intent, and only the writer whose intent move landed tells what the receipt does not.
async function settle(
  parts: BridgeFollowParts,
  followed: Followed,
  call: {
    readonly settled: NonNullable<Awaited<ReturnType<typeof readSettlement>>>;
    readonly signal: AbortSignal;
  },
): Promise<void> {
  const { bridge, snapshot, quote } = followed;
  const { to, read } = call.settled;
  const { signal } = call;
  const holder = await parts.bridges.settledBy(read.tx, { signal });
  if (holder !== undefined && holder.intentId !== bridge.intentId) {
    return;
  }
  const atMs = parts.clock.now();
  const walletId = snapshot.record.walletId;
  const refund = {
    walletId,
    refundTx: read.tx,
    received: read.received,
    sinceMs: bridge.sentAtMs,
    atMs,
  };
  const positions = { positions: parts.positions, store: parts.positionStore };
  if (to === "refunded" && !(await recordRefund(positions, refund, signal))) {
    return;
  }
  const base = { intentId: bridge.intentId, expectedVersion: bridge.version, atMs };
  const move: BridgeMove =
    to === "delivered"
      ? { ...base, to, fillTx: read.tx, received: read.received }
      : { ...base, to, refundTx: read.tx, received: read.received };
  const moved = await parts.bridges.move(move, { signal });
  if (!moved.ok) {
    return;
  }
  if (await reconciles(parts, snapshot, signal)) {
    await tellSettled(parts, { snapshot, bridge: moved.value, quote }, signal);
  }
}

// Moves the intent to `reconciled` on a delivery read; true only for the write that landed, which
// alone tells the owner.
async function reconciles(
  parts: BridgeFollowParts,
  snapshot: IntentSnapshot,
  signal: AbortSignal,
): Promise<boolean> {
  const machine = createIntentStateMachine({ clock: parts.clock });
  const step = machine.apply(snapshot.stored.status, {
    type: "fills_reconciled",
    isDeliveryRead: true,
  });
  if (!step.ok) {
    return false;
  }
  const write = { intent: snapshot.record.id, version: snapshot.stored.version, step: step.value };
  return (await parts.stored.move({ ...write, by: "engine" }, { signal })).ok;
}

// The bridge with its final intent, the quote its card confirmed and its venue; none for a bridge
// whose intent is not final or whose venue no longer runs.
async function followedOf(
  parts: Following,
  bridge: BridgeRecord,
  signal: AbortSignal,
): Promise<{ readonly followed: Followed; readonly venue: Bridge } | undefined> {
  const snapshot = await parts.stored.snapshot(bridge.intentId, { signal });
  const venue = parts.hosted.find((item) => item.bridge.id === bridge.venue)?.bridge;
  if (
    snapshot?.record.state !== "finalized" ||
    snapshot.record.quote === undefined ||
    venue === undefined
  ) {
    return undefined;
  }
  const quote = bridgeQuoteDocument.decode(snapshot.record.quote);
  return { followed: { bridge, snapshot, quote }, venue };
}

// One bridge: its venue's status, the late mark, then a read that may settle it. A venue that does
// not answer still lets the late mark name its page; it, or a chain that does not answer, leaves
// the bridge for the next pass.
async function followOne(
  parts: Following,
  bridge: BridgeRecord,
  signal: AbortSignal,
): Promise<void> {
  const found = await followedOf(parts, bridge, signal);
  if (found === undefined) {
    return;
  }
  const { followed, venue } = found;
  const deposit = { chain: assetRefParts(bridge.sent.asset).chain, hash: bridge.depositTx };
  const status = await parts.reads.read({ venue, deposit, intent: bridge.intentId, signal });
  const statusUrl = status?.statusUrl ?? venue.pageOf(deposit);
  await markLate(parts, followed, { statusUrl, signal });
  if (status === undefined) {
    return;
  }
  const settled = await readSettlement(parts, { ...followed, venue }, { status, signal });
  if (settled !== undefined) {
    const latest = (await parts.bridges.get(bridge.intentId, { signal })) ?? bridge;
    await settle(parts, { ...followed, bridge: latest }, { settled, signal });
  }
}

/**
 * Creates the follower of bridges in transit (decision 0297), which the composition root runs on
 * a timer: each pass reads the next 100 bridges in transit or late, oldest first, one at a time,
 * and starts again from the oldest once it read the last. It
 * marks one late once, 2 hours after its deposit was final, with `notice.bridgeLate`; asks its
 * venue where it stands; and moves it to `reconciled` only once a read of its own destination
 * chain finds the payment, at least its least output, or a read of its source chain the refund,
 * whose units arrive back at their value then, each matched to this deposit by the venue's own
 * events and held by no other bridge. No timer ends a bridge unread. A bridge whose status cannot
 * be read is still marked late with its venue's page; it, and one whose read throws, waits for the
 * next pass, and the pass goes on (`createStatusReads` logs, rests and tells).
 */
export function createBridgeFollower(parts: BridgeFollowParts): {
  readonly follow: (options: { readonly signal: AbortSignal }) => Promise<void>;
} {
  const following: Following = { ...parts, reads: createStatusReads(parts) };
  // Where the last pass stopped, so each pass reads the next 100 and no row starves the others.
  let cursor: BridgeCursor | undefined;
  return {
    async follow({ signal }) {
      const query = { states: openBridgeStates, limit: passLimit };
      const open = await parts.bridges.list(
        cursor === undefined ? query : { ...query, after: cursor },
        { signal },
      );
      const last = open.at(-1);
      cursor =
        open.length < passLimit || last === undefined
          ? undefined
          : { sentAtMs: last.sentAtMs, intentId: last.intentId };
      for (const bridge of open) {
        try {
          // oxlint-disable-next-line eslint/no-await-in-loop -- one bridge at a time keeps the node reads paced
          await followOne(following, bridge, signal);
        } catch (error) {
          // A node or a venue that failed this pass is read again on the next.
          signal.throwIfAborted();
          const errorCode = error instanceof BinferenceError ? error.code : "internal.error";
          parts.log?.warn("bridge.follow_failed", { intentId: bridge.intentId, errorCode });
        }
      }
    },
  };
}
