import type { LaunchTokenRequest } from "@binference/protocol";
import type { CardFacts, CardWarnings } from "../confirmations/draw-card.js";
import type { LaunchDetails, LaunchLink } from "../confirmations/launch-card-lines.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { TokenLaunchQuote } from "../intents/token-launch-quote.js";
import type { CardSource } from "./card-facts-of.js";

const formats = {
  "image/png": "png",
  "image/jpeg": "jpeg",
  "image/webp": "webp",
} as const;

// The digits of the picture's SHA-256 a card shows; the terms hash binds all of them.
const digestDigits = 16;

function linksOf(links: LaunchTokenRequest["links"]): readonly LaunchLink[] {
  const sites = ["website", "x", "telegram"] as const;
  return sites.flatMap((site) => {
    const url = links?.[site];
    return url === undefined ? [] : [{ site, url }];
  });
}

// The picture the launch uploaded; none for a launchpad that takes it as a link (decision 0276).
function pictureOf(quote: TokenLaunchQuote): Pick<LaunchDetails, "picture"> {
  const { image, metadataUri } = quote;
  if (image === undefined || metadataUri === undefined) {
    return {};
  }
  const picture = {
    format: formats[image.contentType],
    kib: Math.ceil(image.bytes / 1024),
    digest: image.sha256.slice(0, digestDigits),
    uri: metadataUri,
  };
  return { picture };
}

// Every setting beyond the action line, from the request and the launch's quote (decision 0235).
function detailsOf(request: LaunchTokenRequest, quote: TokenLaunchQuote): LaunchDetails {
  const { firstBuy, token } = quote;
  const { description } = request;
  return {
    venue: request.venue,
    token,
    ...(firstBuy === undefined ? {} : { firstBuyMinOut: { asset: token, base: firstBuy.minOut } }),
    fee: quote.fee,
    ...(description === undefined ? {} : { description }),
    links: linksOf(request.links),
    ...pictureOf(quote),
    settings: quote.settings,
  };
}

/**
 * The facts of a token launch's card (spec 4, section 3.3; decision 0235): its action line and
 * every other setting, each from its request or its quote, which the card's terms hash covers,
 * the launch wallet it runs from, and the agent's reason. `undefined` for any other request.
 */
export function launchCardFacts(
  quote: TokenLaunchQuote,
  source: CardSource,
  warnings: CardWarnings,
): CardFacts | undefined {
  const { record, card, settings, launchWallet } = source;
  const request = requestDocument.decode(record.request);
  if (request.kind !== "launchToken") {
    return undefined;
  }
  const { symbol, name, venue, pairWith } = request;
  const firstBuy = request.firstBuy ?? { asset: pairWith, base: 0n };
  const details = detailsOf(request, quote);
  return {
    agentName: settings.agent.name,
    isPaper: record.isPaper,
    hasOutsideContent: record.hasOutsideContent,
    card: { version: card.version, openedAtMs: card.openedAtMs, expiresAtMs: card.expiresAtMs },
    action: { kind: "launchToken", symbol, name, venue, pair: pairWith, firstBuy, details },
    ...(launchWallet === undefined ? {} : { launchWallet }),
    warnings: {
      ...warnings,
      ...(quote.firstBuy?.isUnbound === true ? { hasUnboundFirstBuy: true } : {}),
    },
    reason: request.reason,
  };
}
