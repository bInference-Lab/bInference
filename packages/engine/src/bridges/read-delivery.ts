import {
  type AccountRef,
  type Amount,
  type AssetRef,
  assetRefParts,
  type Bridge,
  type Delivery,
  type DeliveryReader,
  type DepositRef,
  type SettlementCheck,
  type SettlementSide,
} from "@binference/chain";
import type { BridgeRecord } from "./bridge-record.js";

/** What a read found: the transaction that moved the funds and what it brought. */
export interface ReadSettlement {
  readonly tx: DepositRef["hash"];
  readonly received: Amount;
}

/**
 * What a settlement is read against: the bridge's row, its venue, the deposit as its own chain's
 * read found it, and the wallet that deposited.
 */
export interface SettlementReading {
  readonly bridge: BridgeRecord;
  readonly venue: Pick<Bridge, "settlement">;
  readonly deposit: SettlementSide;
  readonly wallet: AccountRef;
}

// One transaction's read, when its block is final and it succeeded.
async function finalRead(
  reader: DeliveryReader,
  read: {
    readonly hash: DepositRef["hash"];
    readonly recipient: AccountRef;
    readonly asset: AssetRef;
  },
  signal: AbortSignal,
): Promise<Delivery | undefined> {
  const delivery = await reader.delivery(read, { signal });
  return delivery?.final === true && delivery.status === "success" ? delivery : undefined;
}

// What the venue says the settlement paid for this deposit by its events, or none when they name
// another deposit, recipient or token (decision 0320).
function paidFor(
  reading: SettlementReading,
  kind: SettlementCheck["kind"],
  settlement: SettlementSide,
): bigint | undefined {
  const { bridge, venue, deposit, wallet } = reading;
  const check = {
    kind,
    deposit,
    settlement,
    wallet,
    amountIn: bridge.sent,
    recipient: bridge.recipient,
    minOut: bridge.minOut,
  };
  const paid = venue.settlement(check);
  return paid.ok ? paid.value : undefined;
}

// What arrived for this deposit: what the read found, no more than the venue's own event says it
// paid, so a transaction that paid others too counts only this deposit's share.
const ownShare = (delivery: Delivery, paid: bigint): Amount => ({
  asset: delivery.received.asset,
  base: delivery.received.base < paid ? delivery.received.base : paid,
});

/**
 * Reads the deposit's own transaction on its source chain, at the chain's finality, with the
 * events a venue matches a settlement against; none while no final block holds it.
 */
export async function readDeposit(
  readers: readonly DeliveryReader[],
  sent: { readonly bridge: BridgeRecord; readonly wallet: AccountRef },
  signal: AbortSignal,
): Promise<SettlementSide | undefined> {
  const { bridge, wallet } = sent;
  const chain = assetRefParts(bridge.sent.asset).chain;
  const reader = readers.find((item) => item.chain === chain);
  const read = { hash: bridge.depositTx, recipient: wallet, asset: bridge.sent.asset };
  const delivery = reader === undefined ? undefined : await finalRead(reader, read, signal);
  return delivery === undefined
    ? undefined
    : { ref: { chain, hash: bridge.depositTx }, events: delivery.events };
}

/**
 * Reads a bridge's fill on its own destination chain (decisions 0297, 0317 and 0320): the
 * transaction the bridge named, at the chain's finality, whose events the venue takes as this
 * deposit's own fill, paying the recipient at least the least output in the token the route
 * delivers, or in the coin a fill pays a plain wallet in its place. A fill on any other chain, a
 * chain with no reader, a transaction the venue does not own, such as a bare transfer, or a
 * payment under the least output is none.
 */
export async function readFill(
  readers: readonly DeliveryReader[],
  reading: SettlementReading & { readonly fill: DepositRef },
  signal: AbortSignal,
): Promise<ReadSettlement | undefined> {
  const { bridge, fill } = reading;
  const reader = readers.find((item) => item.chain === bridge.toChain);
  if (fill.chain !== bridge.toChain || reader === undefined) {
    return undefined;
  }
  const read = { hash: fill.hash, recipient: bridge.recipient };
  const token = await finalRead(reader, { ...read, asset: bridge.minOut.asset }, signal);
  const paid =
    token === undefined ? undefined : paidFor(reading, "fill", { ref: fill, events: token.events });
  if (token === undefined || paid === undefined) {
    return undefined;
  }
  const inToken = ownShare(token, paid);
  if (inToken.base >= bridge.minOut.base) {
    return { tx: fill.hash, received: inToken };
  }
  const inCoin = await coinShare(reader, { bridge, fill, paid }, signal);
  return inCoin !== undefined && inCoin.base >= bridge.minOut.base
    ? { tx: fill.hash, received: inCoin }
    : undefined;
}

// What the fill paid the recipient of the coin a fill pays a plain wallet in place of the route's
// token, no more than the venue says it paid; none for a route with no such coin.
async function coinShare(
  reader: DeliveryReader,
  fill: { readonly bridge: BridgeRecord; readonly fill: DepositRef; readonly paid: bigint },
  signal: AbortSignal,
): Promise<Amount | undefined> {
  const { bridge, paid } = fill;
  if (bridge.deliveredAsCoin === undefined) {
    return undefined;
  }
  const read = { hash: fill.fill.hash, recipient: bridge.recipient, asset: bridge.deliveredAsCoin };
  const coin = await finalRead(reader, read, signal);
  return coin === undefined ? undefined : ownShare(coin, paid);
}

/**
 * Reads a bridge's refund on its source chain (decisions 0297 and 0320): the transaction the
 * bridge named, at the chain's finality, whose events the venue takes as this deposit's refund,
 * paying the wallet back some of the token it sent, no more than the venue says this deposit got
 * back nor than it sent. A refund on another chain, a chain with no reader, one the venue does not own, or one
 * that paid nothing back is none.
 */
export async function readRefund(
  readers: readonly DeliveryReader[],
  reading: SettlementReading & { readonly refund: DepositRef },
  signal: AbortSignal,
): Promise<ReadSettlement | undefined> {
  const { bridge, refund, wallet } = reading;
  const reader = readers.find((item) => item.chain === refund.chain);
  if (reader === undefined || assetRefParts(bridge.sent.asset).chain !== refund.chain) {
    return undefined;
  }
  const read = { hash: refund.hash, recipient: wallet, asset: bridge.sent.asset };
  const delivery = await finalRead(reader, read, signal);
  const paid =
    delivery === undefined
      ? undefined
      : paidFor(reading, "refund", { ref: refund, events: delivery.events });
  if (delivery === undefined || paid === undefined) {
    return undefined;
  }
  // A refund pays back no more than the deposit sent, whatever else its transaction paid the wallet.
  const sent = bridge.sent.base;
  const received = ownShare(delivery, paid < sent ? paid : sent);
  return received.base > 0n ? { tx: refund.hash, received } : undefined;
}
