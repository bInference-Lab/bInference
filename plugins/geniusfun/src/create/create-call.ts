import type { WrittenWords } from "@binference/plugin-sdk";
import type { Address, Hex } from "viem";
import { type CreateCall, createCallData, createCallOf } from "../contracts/launch-call.js";
import type { GeniusLaunchSettings } from "./launch-settings.js";

// What every launch of this venue writes beyond its settings and words (decision 0277): the one
// launch configuration (0), no creator tax, which the factory's maximum holds at 0, the buyback
// on, which the m4.2 Foundation fee policy requires, no Discord or Farcaster link, the destination
// share of the fee to the creator's recipient and never to the Foundation, and no wallet exempted
// from the snipe tax beyond those the contracts exempt themselves: the launcher, the creator fee
// recipient and the first buy's recipient.
const launchConfigId = 0n;
const noCreatorTax = 0;
const isBuybackOn = true;
const isToFoundation = false;

/** A first buy as the router's `launchAndBuy` takes it. */
export interface CreateFirstBuy {
  readonly quoteIn: bigint;
  readonly minimum: bigint;
  readonly recipient: Address;
}

/** What a create call makes beyond its settings: the token, its words, its pair and first buy. */
export interface CreateTerms {
  readonly name: string;
  readonly symbol: string;
  readonly words: WrittenWords;
  /** The pair, as the factory names it: the zero address for the chain's coin. */
  readonly pairToken: Address;
  readonly economics: Hex;
  readonly salt: Hex;
  /** Absent for a launch with no first buy, which the factory makes alone. */
  readonly firstBuy?: CreateFirstBuy;
}

/** The create call of a launch with these terms and settings. */
export function createCallFor(terms: CreateTerms, settings: GeniusLaunchSettings): CreateCall {
  const { words, firstBuy } = terms;
  const params = {
    name: terms.name,
    symbol: terms.symbol,
    logo: settings.pictureLink,
    description: words.description,
    socials: {
      twitter: words.links.x,
      telegram: words.links.telegram,
      discord: "",
      website: words.links.website,
      farcaster: "",
    },
    creatorFeeRecipient: settings.creatorFeeRecipient,
    creatorTaxBps: noCreatorTax,
    buybackEnabled: isBuybackOn,
    expectedEconomics: terms.economics,
    salt: terms.salt,
  };
  const base = {
    params,
    configId: launchConfigId,
    pairToken: terms.pairToken,
    toFoundation: isToFoundation,
  };
  return firstBuy === undefined
    ? { kind: "launch", ...base }
    : { kind: "launchAndBuy", ...base, ...firstBuy };
}

/** A create call as this venue reads it back: its terms and its settings. */
export interface ReadCreate {
  readonly terms: CreateTerms;
  readonly settings: GeniusLaunchSettings;
}

// The terms and settings a decoded create call writes, read field by field.
function readOf(call: CreateCall): ReadCreate {
  const { params } = call;
  const words = {
    description: params.description,
    links: {
      website: params.socials.website,
      x: params.socials.twitter,
      telegram: params.socials.telegram,
    },
  };
  const firstBuy =
    call.kind === "launch"
      ? {}
      : { firstBuy: { quoteIn: call.quoteIn, minimum: call.minimum, recipient: call.recipient } };
  const terms: CreateTerms = {
    name: params.name,
    symbol: params.symbol,
    words,
    pairToken: call.pairToken,
    economics: params.expectedEconomics,
    salt: params.salt,
    ...firstBuy,
  };
  const settings = {
    creatorFeeRecipient: params.creatorFeeRecipient,
    pictureLink: params.logo,
  };
  return { terms, settings };
}

/**
 * The terms and settings a create calldata writes, when it is one this venue builds: every fixed
 * value as {@link createCallFor} writes it, the Foundation never chosen, and the same bytes the
 * venue would write for what it reads, with none after them. Any other calldata: undefined.
 */
export function readCreateCall(data: Hex): ReadCreate | undefined {
  const call = createCallOf(data);
  if (call === undefined) {
    return undefined;
  }
  const read = readOf(call);
  const isOurs = createCallData(createCallFor(read.terms, read.settings)) === data.toLowerCase();
  return isOurs ? read : undefined;
}
