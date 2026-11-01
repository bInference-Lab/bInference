import type { AccountRef, Amount, AssetRef } from "@binference/chain";
import type { Bps } from "@binference/core";
import type { CardLine, CardValue } from "./card-line.js";
import { type CardPayee, payeeValue } from "./send-card-lines.js";

/** What a bridge's card shows under its action line (spec 4, section 3.9). */
interface BridgeDetails {
  /** The least the fill pays the recipient, in the token the route delivers. */
  readonly minOut: Amount;
  /** What the bridge keeps of the input, all its parts in the input's token. */
  readonly fees: Amount;
  readonly venue: string;
  /** The recipient's address carries no checksum, as a 32-byte Solana address does. */
  readonly isChecksumless: boolean;
  /** The token that arrives differs from the one sent, such as USDC arriving as USDG. */
  readonly otherToken?: { readonly sent: AssetRef; readonly received: AssetRef };
  /** The share of the input less the fees a swap's rate keeps, on a route filled by a swap. */
  readonly swapRateBps?: Bps;
}

/** A bridge's action and what shows under it: who it pays, on which chain, and in what time. */
export interface BridgeAction {
  readonly amount: Amount;
  /** The destination chain as the registry names it, such as Base. */
  readonly chain: string;
  readonly recipient: AccountRef;
  readonly payee?: CardPayee;
  readonly minutes: number;
  readonly details?: BridgeDetails;
}

const text = (value: string): CardValue => ({ type: "text", text: value });

/** A bridge's action line (spec 4, sections 3.3 and 3.9). */
export function bridgeActionLine(action: BridgeAction): CardLine {
  return {
    key: "card.bridge.action",
    values: {
      amount: { type: "amount", amount: action.amount },
      chain: text(action.chain),
      recipient: payeeValue(action.recipient, action.payee),
      minutes: { type: "count", count: action.minutes },
    },
  };
}

/**
 * The lines under a bridge's action line (spec 4, section 3.9): what the recipient receives at
 * least there, the bridge's fees and venue, on a route filled by a swap the swap's rate
 * (decision 0323), that binference reads the destination chain, and, for an address with no
 * checksum, a line to check it whole.
 */
export function bridgeDetailLines(action: BridgeAction): readonly CardLine[] {
  const { details } = action;
  if (details === undefined) {
    return [];
  }
  const chain = text(action.chain);
  const swapRate: readonly CardLine[] =
    details.swapRateBps === undefined
      ? []
      : [
          {
            key: "card.bridge.swapRate",
            values: { rate: { type: "percent", bps: details.swapRateBps } },
          },
        ];
  const lines: readonly CardLine[] = [
    {
      key: "card.bridge.arrives",
      values: {
        recipient: payeeValue(action.recipient, action.payee),
        minOut: { type: "amount", amount: details.minOut },
        chain,
      },
    },
    {
      key: "card.bridge.fees",
      values: { fees: { type: "amount", amount: details.fees }, venue: text(details.venue) },
    },
    ...swapRate,
    { key: "card.bridge.read", values: { chain } },
  ];
  return details.isChecksumless ? [...lines, { key: "card.bridge.solana", values: {} }] : lines;
}

/** The warning that a bridge delivers another token than it sends, or none. */
export function bridgeTokenWarning(action: BridgeAction): readonly CardLine[] {
  const other = action.details?.otherToken;
  return other === undefined
    ? []
    : [
        {
          key: "card.bridge.otherToken",
          values: {
            sent: { type: "asset", asset: other.sent },
            chain: text(action.chain),
            received: { type: "asset", asset: other.received },
          },
        },
      ];
}
