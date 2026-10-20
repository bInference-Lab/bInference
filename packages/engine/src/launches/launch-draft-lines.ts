import type { ChainRegistry } from "@binference/chain";
import type { AssetInfos } from "@binference/protocol";
import { actionLine } from "../confirmations/card-action.js";
import type { CardLine } from "../confirmations/card-line.js";
import { type LaunchDetails, launchDetailLines } from "../confirmations/launch-card-lines.js";
import { assetInfosOf } from "../money-path/asset-infos.js";
import { digestDigits, linksOf, pictureFormats } from "../surfaces/launch-card-facts.js";
import type { PicturePlace } from "../venues/launch-declarations.js";
import type { LaunchDraft } from "./launch-draft-shelf.js";

/** A launch draft's lines as the owner's chat shows them, with the assets they name. */
export interface DrawnLaunchDraft {
  readonly lines: readonly CardLine[];
  readonly assets: AssetInfos;
}

// The owner's photo as the draft read it (decision 0286): as the create call will write it, or as
// a photo the launchpad will upload.
function photoOf(
  draft: LaunchDraft,
  place: PicturePlace | undefined,
): Pick<LaunchDetails, "picture"> {
  const image = draft.picture?.image;
  if (image === undefined) {
    return {};
  }
  const format = pictureFormats[image.contentType];
  const digest = image.sha256.slice(0, digestDigits);
  const { width, height } = image;
  return place === "create_call" && width !== undefined && height !== undefined
    ? { picture: { format, bytes: image.bytes, width, height, digest } }
    : { picture: { format, kib: Math.ceil(image.bytes / 1024), digest } };
}

/**
 * The lines of a launch draft (decision 0285): the action line the card will show, then the
 * description, each link, the owner's photo and every launchpad setting with its default filled
 * in, on a launchpad that uploads the warning that Start publishes the words and picture at once,
 * and the outside content warning when the drafting turn read any. Each value from the draft
 * is a text the card shows as outside text. The fee, the new token and the first buy's least
 * output come with the card.
 */
export function drawLaunchDraft(
  draft: LaunchDraft,
  options: { readonly chains: ChainRegistry; readonly place: PicturePlace | undefined },
): DrawnLaunchDraft {
  const { request, settings } = draft;
  const { symbol, name, venue, pairWith, description } = request;
  const firstBuy = request.firstBuy ?? { asset: pairWith, base: 0n };
  const action = actionLine({ kind: "launchToken", symbol, name, venue, pair: pairWith, firstBuy });
  const details: LaunchDetails = {
    venue,
    pair: pairWith,
    ...(description === undefined ? {} : { description }),
    links: linksOf(request.links),
    ...photoOf(draft, options.place),
    settings,
  };
  const warned: readonly CardLine[] = draft.hasOutsideContent
    ? [{ key: "card.warn.outsideContent", values: {} }]
    : [];
  // On a launchpad that uploads, Start itself publishes the words and picture, before the card.
  const published: readonly CardLine[] =
    options.place === "upload"
      ? [{ key: "card.launch.startPublishes", values: { venue: { type: "text", text: venue } } }]
      : [];
  const lines = [action, ...launchDetailLines(details), ...published, ...warned];
  return { lines, assets: assetInfosOf(options.chains, [pairWith]) };
}
