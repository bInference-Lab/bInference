import { accountRefParts, type Amount, type ChainRegistry, type TxHash } from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { InstallStore, PositionStore } from "../ports.js";
import type { Positions } from "../positions/create-positions.js";
import type { PublishPush } from "../pushes/engine-push.js";
import { type Notice, noticePush } from "../pushes/notice-push.js";
import type { BridgeDraft, BridgeRecord } from "./bridge-record.js";

/** When a bridge not delivered counts as late: 2 hours after its deposit is final (decision 0297). */
export const bridgeLateAfterMs: number = 2 * 60 * 60 * 1000;

// How many of the wallet's arrivals since the deposit a refund is looked for among.
const arrivalPage = 1_000;

/** A bridge as its final deposit opens it: what it sent, to whom, and what it must deliver. */
export function bridgeDraftOf(
  record: Pick<IntentRecord, "id">,
  quote: BridgeIntentQuote,
  deposit: { readonly txHash: BridgeDraft["depositTx"]; readonly sentAtMs: number },
): BridgeDraft {
  return {
    intentId: record.id,
    venue: quote.venue,
    depositTx: deposit.txHash,
    toChain: accountRefParts(quote.recipient).chain,
    recipient: quote.recipient,
    sent: quote.amount,
    minOut: quote.minOut,
    ...(quote.deliveredAsCoin === undefined ? {} : { deliveredAsCoin: quote.deliveredAsCoin }),
    sentAtMs: deposit.sentAtMs,
  };
}

/** Whether a read settled the bridge: its delivery or its refund was found. */
export function isSettled(bridge: Pick<BridgeRecord, "state">): boolean {
  return bridge.state === "delivered" || bridge.state === "refunded";
}

/** A refund a read found: whose wallet it paid, by which transaction, what, and since when. */
export interface FoundRefund {
  readonly walletId: IntentRecord["walletId"];
  readonly refundTx: TxHash;
  readonly received: Amount;
  /** The deposit's final block time, after which the refund's arrival is looked for. */
  readonly sinceMs: number;
  readonly atMs: number;
}

/**
 * Records a refund's units, back in its wallet, as an arrival at their value now, once: an arrival
 * of the wallet since the deposit with the refund's transaction is not stored again. The follower
 * alone records refunds, one bridge at a time and before it settles the bridge's row, so a stop
 * between the two records it once (decision 0320). True once it is stored.
 */
export async function recordRefund(
  parts: {
    readonly positions: Pick<Positions, "receive">;
    readonly store: Pick<PositionStore, "arrivals">;
  },
  refund: FoundRefund,
  signal: AbortSignal,
): Promise<boolean> {
  const { walletId, refundTx, received, sinceMs, atMs } = refund;
  const query = { after: 0, limit: arrivalPage, isPaper: false, walletId, fromMs: sinceMs };
  const earlier = await parts.store.arrivals(query, { signal });
  if (earlier.some((arrival) => arrival.txHash === refundTx)) {
    return true;
  }
  const arrival = { walletId, isPaper: false, atMs, received, txHash: refundTx };
  return (await parts.positions.receive(arrival, { signal })).ok;
}

/** The info of the assets a bridge's notices name: the token sent, the one delivered, its coin. */
export function bridgeAssetsOf(
  chains: ChainRegistry,
  snapshot: Pick<IntentSnapshot, "record">,
  quote: BridgeIntentQuote,
): AssetInfos {
  const coin = quote.deliveredAsCoin === undefined ? [] : [quote.deliveredAsCoin];
  return intentAssetInfos(chains, snapshot.record, [
    quote.amount.asset,
    quote.minOut.asset,
    ...coin,
  ]);
}

/** The label of the wallet a bridge left from, which a refund's words name; its id without one. */
export async function walletLabelOf(
  install: Pick<InstallStore, "read">,
  walletId: IntentRecord["walletId"],
  signal: AbortSignal,
): Promise<string> {
  const { wallets } = await install.read({ signal });
  return wallets.find((wallet) => wallet.id === walletId)?.label ?? walletId;
}

/**
 * Tells what a settled bridge's receipt does not (spec 6, section 8), from whichever path moved
 * its intent to `reconciled`, which alone tells it: the follower's read or recovery's
 * reconciliation after a stop (decision 0320).
 */
export async function tellSettled(
  parts: {
    readonly install: Pick<InstallStore, "read">;
    readonly chains: ChainRegistry;
    readonly publish: PublishPush;
  },
  settled: {
    readonly snapshot: Pick<IntentSnapshot, "record">;
    readonly bridge: BridgeRecord;
    readonly quote: BridgeIntentQuote;
  },
  signal: AbortSignal,
): Promise<void> {
  const { snapshot, bridge, quote } = settled;
  const walletLabel = await walletLabelOf(parts.install, snapshot.record.walletId, signal);
  const assets = bridgeAssetsOf(parts.chains, snapshot, quote);
  const notice = settledNotice(snapshot.record, { bridge, quote, assets, walletLabel });
  if (notice !== undefined) {
    parts.publish(noticePush(notice));
  }
}

/**
 * The notice a settled bridge tells (spec 6, section 8): `notice.bridgeArrived` for a delivery
 * that was late, whose receipt the owner already left, and `notice.bridgeRefunded` for a refund;
 * none for a delivery on time, which its receipt tells.
 */
function settledNotice(
  record: Pick<IntentRecord, "id" | "agentId">,
  settled: {
    readonly bridge: BridgeRecord;
    readonly quote: BridgeIntentQuote;
    readonly assets: AssetInfos;
    /** The label of the wallet a refund came back to. */
    readonly walletLabel: string;
  },
): Notice | undefined {
  const { bridge, quote, assets, walletLabel } = settled;
  const base = { agent: record.agentId, intent: record.id, assets };
  if (bridge.state === "refunded" && bridge.received !== undefined) {
    const values = { venue: quote.venue, chain: quote.chainName, wallet: walletLabel };
    return { ...base, key: "notice.bridgeRefunded", values, amounts: { amount: bridge.received } };
  }
  if (
    bridge.state === "delivered" &&
    bridge.lateAtMs !== undefined &&
    bridge.received !== undefined
  ) {
    const recipient = accountRefParts(quote.recipient).address;
    const values = { chain: quote.chainName, recipient };
    return { ...base, key: "notice.bridgeArrived", values, amounts: { received: bridge.received } };
  }
  return undefined;
}
