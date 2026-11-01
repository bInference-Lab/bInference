import type { AssetInfos } from "@binference/protocol";
import type { CardAction } from "../confirmations/card-action.js";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import type { BridgeIntentQuote } from "../intents/bridge-quote.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import { intentAssetInfos } from "../money-path/asset-infos.js";
import type { CardSource } from "./card-facts-of.js";

// A Solana address is 32 recipient bytes and carries no checksum, unlike an EVM address's 20
// (decision 0298), so its card asks the owner to check it whole.
const checksumlessHexLength = 2 + 32 * 2;

// The token that arrives differs from the one sent when its symbol does, unless the coin a fill
// pays a plain wallet in its place is the token sent, as ETH for WETH (decision 0301).
function otherTokenOf(
  quote: BridgeIntentQuote,
  assets: AssetInfos,
):
  | {
      readonly sent: BridgeIntentQuote["amount"]["asset"];
      readonly received: BridgeIntentQuote["minOut"]["asset"];
    }
  | undefined {
  const sent = assets[quote.amount.asset]?.symbol;
  const received = assets[quote.minOut.asset]?.symbol;
  const coin =
    quote.deliveredAsCoin === undefined ? undefined : assets[quote.deliveredAsCoin]?.symbol;
  return sent === undefined || received === sent || coin === sent
    ? undefined
    : { sent: quote.amount.asset, received: quote.minOut.asset };
}

function bridgeAction(quote: BridgeIntentQuote, source: CardSource): CardAction<"bridge"> {
  const { amount, recipient, label, isRescue, chainName, minOut, venue } = quote;
  const assets = intentAssetInfos(source.chains, source.record, [
    amount.asset,
    minOut.asset,
    ...(quote.deliveredAsCoin === undefined ? [] : [quote.deliveredAsCoin]),
  ]);
  const fees = {
    asset: amount.asset,
    base: quote.fees.reduce((sum, fee) => sum + fee.amount.base, 0n),
  };
  const otherToken = otherTokenOf(quote, assets);
  return {
    kind: "bridge",
    amount,
    chain: chainName,
    recipient,
    payee: {
      ...(label === undefined ? {} : { label }),
      ...(isRescue === undefined ? {} : { isRescue }),
    },
    minutes: Math.max(1, Math.ceil(quote.etaSeconds / 60)),
    details: {
      minOut,
      fees,
      venue,
      isChecksumless: quote.recipientBytes.length === checksumlessHexLength,
      ...(otherToken === undefined ? {} : { otherToken }),
      ...(quote.swapRateBps === undefined ? {} : { swapRateBps: quote.swapRateBps }),
    },
  };
}

/**
 * The facts of a bridge's card (spec 4, sections 3.3 and 3.9), from its quote, which the card's
 * terms hash covers: the amount, the destination chain and the address it pays, labeled as the
 * address book or the rescue address names it, the minutes the bridge expects, the least the
 * recipient receives, the bridge's fees and venue, the swap's rate on a route filled by a swap,
 * a line for an address with no checksum and a warning for another token on arrival; then the bridge wallet it runs from and the agent's reason.
 */
export function bridgeCardFacts(
  quote: BridgeIntentQuote,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts {
  const { record, card, settings, roleWallet } = source;
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: bridgeAction(quote, source),
    ...(roleWallet === undefined ? {} : { roleWallet }),
    warnings,
    reason: requestDocument.decode(record.request).reason,
  };
}
