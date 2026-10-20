import { decimalStringSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { UsdPrice } from "../ports.js";
import type { TxDraft } from "../transaction.js";
import { type LaunchOptionValue, launchOptionValuesSchema } from "./launch-option.js";
import { type LaunchWords, type WrittenWords, writtenWordsSchema } from "./launch-words.js";

/**
 * What every launch request the venue host makes of a launchpad holds: the token's name and
 * symbol, the asset it trades against, the first buy, the launchpad's own settings, every one with
 * its value, and the launchpad's declared contracts on the wallet's chain, by their names in the
 * chain registry. The launch wallet makes the token and its first buy, and receives what it buys.
 */
export interface LaunchTerms {
  readonly wallet: AccountRef;
  readonly name: string;
  readonly symbol: string;
  /** The asset the new token trades against on its launchpad, on the wallet's chain. */
  readonly pair: AssetRef;
  /** What the first buy spends, in `pair`; absent for a launch with no first buy. */
  readonly firstBuy?: Amount;
  /** Each setting the launchpad declares, by name, its default filled in; an optional one left out may be absent. */
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  readonly contracts: Readonly<Record<string, AccountRef>>;
  /**
   * binference's USD price of the pair when the launch is quoted (decision 0280), for a launchpad
   * that works out a setting from it, such as a starting price; absent when it has none.
   */
  readonly pairUsdPrice?: UsdPrice;
}

/**
 * What a launch costs and gives, read from the launchpad's contracts alone: nothing is uploaded
 * or pinned to quote it.
 */
export interface LaunchQuote {
  /** The launchpad's own fee for a launch, in the chain's coin; zero base units for none. */
  readonly fee: Amount;
  /**
   * What the first buy gets of the new token at the start of its launch, in base units; given
   * exactly when the terms hold a first buy.
   */
  readonly firstBuyOut?: bigint;
  /** The new token's decimals, which its amounts are written in. */
  readonly tokenDecimals: number;
  /**
   * The values the launchpad worked out for optional settings the terms leave out (decision
   * 0280), such as a starting price: the card shows them, and the create call must write them.
   * Each names an optional setting the launchpad declares; left out, none.
   */
  readonly settings?: Readonly<Record<string, LaunchOptionValue>>;
}

/** The owner's picture of a launch: its type (`image/png`, `image/jpeg` or `image/webp`) and its bytes. */
export interface LaunchPicture {
  readonly contentType: string;
  readonly bytes: Readonly<Uint8Array>;
}

/** The launch's words and picture, which the launchpad uploads and pins through its own API. */
export interface LaunchPinRequest extends LaunchTerms, LaunchWords {
  readonly image: LaunchPicture;
}

/** What an upload gave: the metadata address the token's create call names, and its pin. */
export interface LaunchPin {
  /** The address of the token's metadata, as the create call writes it: at most 200 characters. */
  readonly metadataUri: string;
  /**
   * The launchpad's own handle of the pin, which the host keeps and gives back to `pinStatus`: at
   * most 1 KiB as JSON.
   */
  readonly pin: JsonValue;
}

/**
 * Where a launchpad's pin of an upload stands: `pinned` once the launchpad reports it, `failed`
 * once it reports that it never will, else `pending`.
 */
export type PinStatus = "pending" | "pinned" | "failed";

/**
 * What the host asks a launchpad to build, once its quote and its upload are in hand, with the
 * launch's words, which a launchpad that keeps them on chain writes into its create call.
 */
export interface LaunchBuildRequest extends LaunchTerms, LaunchWords {
  /** The metadata address the upload gave; absent for a launchpad that uploads nothing. */
  readonly metadataUri?: string;
  /**
   * The owner's picture, for a launchpad that writes it into its create call (decision 0279);
   * absent for any other.
   */
  readonly picture?: LaunchPicture;
  /** The launch fee the quote read, which the create call pays. */
  readonly fee: Amount;
  /** The least of the new token the first buy accepts, in base units; with a first buy alone. */
  readonly firstBuyMinOut?: bigint;
}

/** The launch's steps, the token its create call makes, and what the build worked out. */
export interface LaunchBuild {
  /**
   * The token the create call makes, at the address the launchpad's contracts give it before the
   * call runs. The engine refuses a launch whose token address already holds code (decision 0238).
   */
  readonly token: AssetRef;
  /** In order: at most one exact approval of the first buy's spend, then the create call. */
  readonly steps: readonly TxDraft[];
  /**
   * The values the build worked out for optional settings neither the request nor the quote gave,
   * such as an address that depends on the token (decision 0280): the card shows them, and the
   * create call writes them. Left out, none.
   */
  readonly settings?: Readonly<Record<string, LaunchOptionValue>>;
}

/** What a launchpad's create call does, read back from its bytes by the launchpad's decoder. */
export interface DecodedLaunch {
  readonly token: AssetRef;
  readonly name: string;
  readonly symbol: string;
  /** The metadata address the call names; absent for a launchpad that uploads nothing. */
  readonly metadataUri?: string;
  /**
   * The picture the call writes, for a launchpad that writes it in (decision 0279): its type and
   * the SHA-256 of its bytes as lowercase hex. The host refuses a call whose picture is not the
   * card's.
   */
  readonly picture?: WrittenPicture;
  readonly pair: AssetRef;
  /** The launch fee the call pays, in base units of the chain's coin. */
  readonly feeBase: bigint;
  /** The first buy the call makes; absent for none. */
  readonly firstBuy?: {
    readonly spend: Amount;
    readonly minOut: bigint;
    readonly recipient: AccountRef;
  };
  /**
   * Every setting the launchpad declares, by name, as the call writes it: an `account` as its
   * account id on the launch's chain. The host refuses a call whose settings differ from those the
   * card shows (decision 0238).
   */
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  /**
   * The description and links the call writes on chain, for a launchpad whose create call keeps
   * them; absent for one whose words go in the uploaded metadata. The host refuses a call whose
   * words differ from those the card shows.
   */
  readonly words?: WrittenWords;
}

/** A picture a create call writes, by its type and the SHA-256 of its bytes. */
export interface WrittenPicture {
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  /** Lowercase hex, 64 digits. */
  readonly sha256: string;
}

/** Checks a picture a create call writes. */
export const writtenPictureSchema: z.ZodType<WrittenPicture, WrittenPicture> = z.strictObject({
  contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** A {@link LaunchQuote} as JSON carries it. */
export interface LaunchQuoteWire {
  readonly fee: AmountWire;
  readonly firstBuyOut?: string;
  readonly tokenDecimals: number;
  readonly settings?: Readonly<Record<string, LaunchOptionValue>>;
}

/** Decodes a launch quote from JSON, and encodes it back with `z.encode`. */
export const launchQuoteSchema: z.ZodType<LaunchQuote, LaunchQuoteWire> = z.strictObject({
  fee: amountSchema,
  firstBuyOut: decimalStringSchema.exactOptional(),
  tokenDecimals: z.int().min(0).max(36),
  settings: launchOptionValuesSchema.exactOptional(),
});

// A pin's handle is stored in the launch's quote and hashed with its terms, so it stays small.
const pinHandleMostBytes = 1_024;

const isSmallHandle = (pin: JsonValue): boolean =>
  new TextEncoder().encode(JSON.stringify(pin)).byteLength <= pinHandleMostBytes;

/**
 * Checks a launch pin: a metadata address of at most 200 characters, which a launch card shows
 * whole, and a handle of at most 1 KiB as JSON.
 */
export const launchPinSchema: z.ZodType<LaunchPin> = z.strictObject({
  metadataUri: z.string().min(1).max(200),
  pin: z.json().refine(isSmallHandle, { message: "A pin's handle is over 1 KiB as JSON." }),
});

/** Checks a pin status. */
export const pinStatusSchema: z.ZodType<PinStatus> = z.enum(["pending", "pinned", "failed"]);

/** A {@link DecodedLaunch} as JSON carries it. */
export interface DecodedLaunchWire {
  readonly token: string;
  readonly name: string;
  readonly symbol: string;
  readonly metadataUri?: string;
  readonly picture?: WrittenPicture;
  readonly pair: string;
  readonly feeBase: string;
  readonly firstBuy?: {
    readonly spend: AmountWire;
    readonly minOut: string;
    readonly recipient: string;
  };
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  readonly words?: WrittenWords;
}

/** Decodes a decoded launch from JSON, and encodes it back with `z.encode`. */
export const decodedLaunchSchema: z.ZodType<DecodedLaunch, DecodedLaunchWire> = z.strictObject({
  token: assetRefSchema,
  name: z.string(),
  symbol: z.string(),
  metadataUri: z.string().exactOptional(),
  picture: writtenPictureSchema.exactOptional(),
  pair: assetRefSchema,
  feeBase: decimalStringSchema,
  firstBuy: z
    .strictObject({
      spend: amountSchema,
      minOut: decimalStringSchema,
      recipient: accountRefSchema,
    })
    .exactOptional(),
  options: launchOptionValuesSchema,
  words: writtenWordsSchema.exactOptional(),
});
