import { decimalStringSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { type Amount, type AmountWire, amountSchema } from "../amount.js";
import { type AccountRef, accountRefSchema } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";
import { type LaunchOptionValue, launchOptionValuesSchema } from "./launch-option.js";

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
  /** Each setting the launchpad declares, by name, its default filled in. */
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
  readonly contracts: Readonly<Record<string, AccountRef>>;
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
}

/** The launch's words and picture, which the launchpad uploads and pins through its own API. */
export interface LaunchPinRequest extends LaunchTerms {
  readonly description?: string;
  readonly links?: {
    readonly website?: string;
    readonly x?: string;
    readonly telegram?: string;
  };
  /** The picture: its type (`image/png`, `image/jpeg` or `image/webp`) and its bytes. */
  readonly image: { readonly contentType: string; readonly bytes: Readonly<Uint8Array> };
}

/** What an upload gave: the metadata address the token's create call names, and its pin. */
export interface LaunchPin {
  /** The address of the token's metadata, as the create call writes it. */
  readonly metadataUri: string;
  /** The launchpad's own handle of the pin, which the host keeps and gives back to `pinStatus`. */
  readonly pin: JsonValue;
}

/**
 * Where a launchpad's pin of an upload stands: `pinned` once the launchpad reports it, `failed`
 * once it reports that it never will, else `pending`.
 */
export type PinStatus = "pending" | "pinned" | "failed";

/** What the host asks a launchpad to build, once its quote and its upload are in hand. */
export interface LaunchBuildRequest extends LaunchTerms {
  readonly metadataUri: string;
  /** The launch fee the quote read, which the create call pays. */
  readonly fee: Amount;
  /** The least of the new token the first buy accepts, in base units; with a first buy alone. */
  readonly firstBuyMinOut?: bigint;
}

/** The launch's steps, and the token its create call makes. */
export interface LaunchBuild {
  /**
   * The token the create call makes, at the address the launchpad's contracts give it before the
   * call runs. The engine refuses a launch whose token address already holds code (decision 0238).
   */
  readonly token: AssetRef;
  /** In order: at most one exact approval of the first buy's spend, then the create call. */
  readonly steps: readonly TxDraft[];
}

/** What a launchpad's create call does, read back from its bytes by the launchpad's decoder. */
export interface DecodedLaunch {
  readonly token: AssetRef;
  readonly name: string;
  readonly symbol: string;
  readonly metadataUri: string;
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
}

/** A {@link LaunchQuote} as JSON carries it. */
export interface LaunchQuoteWire {
  readonly fee: AmountWire;
  readonly firstBuyOut?: string;
  readonly tokenDecimals: number;
}

/** Decodes a launch quote from JSON, and encodes it back with `z.encode`. */
export const launchQuoteSchema: z.ZodType<LaunchQuote, LaunchQuoteWire> = z.strictObject({
  fee: amountSchema,
  firstBuyOut: decimalStringSchema.exactOptional(),
  tokenDecimals: z.int().min(0).max(36),
});

/** Checks a launch pin: a metadata address of at most 512 characters, and any handle. */
export const launchPinSchema: z.ZodType<LaunchPin> = z.strictObject({
  metadataUri: z.string().min(1).max(512),
  pin: z.json(),
});

/** Checks a pin status. */
export const pinStatusSchema: z.ZodType<PinStatus> = z.enum(["pending", "pinned", "failed"]);

/** A {@link DecodedLaunch} as JSON carries it. */
export interface DecodedLaunchWire {
  readonly token: string;
  readonly name: string;
  readonly symbol: string;
  readonly metadataUri: string;
  readonly pair: string;
  readonly feeBase: string;
  readonly firstBuy?: {
    readonly spend: AmountWire;
    readonly minOut: string;
    readonly recipient: string;
  };
  readonly options: Readonly<Record<string, LaunchOptionValue>>;
}

/** Decodes a decoded launch from JSON, and encodes it back with `z.encode`. */
export const decodedLaunchSchema: z.ZodType<DecodedLaunch, DecodedLaunchWire> = z.strictObject({
  token: assetRefSchema,
  name: z.string(),
  symbol: z.string(),
  metadataUri: z.string(),
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
});
