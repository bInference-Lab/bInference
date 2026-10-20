import {
  type Amount,
  type AmountWire,
  amountSchema,
  type AssetRef,
  assetRefSchema,
  launchOptionTypes,
} from "@binference/chain";
import { decimalStringSchema, type JsonValue } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../records/record-fields.js";
import { type Sha256Hex, sha256HexSchema } from "../records/sha256-hex.js";
import type { LaunchSetting } from "../venues/launch-settings.schema.js";
import { type DocumentCodec, documentCodec } from "./intent-documents.schema.js";

/** The picture a launch uploaded: its type, its size in bytes and the SHA-256 of its bytes. */
export interface LaunchImage {
  readonly contentType: "image/png" | "image/jpeg" | "image/webp";
  readonly bytes: number;
  readonly sha256: Sha256Hex;
}

/** A launch's first buy: what it spends, what the quote said it gets, and the least it accepts. */
interface LaunchFirstBuy {
  readonly spend: Amount;
  /** In base units of the new token. */
  readonly expectedOut: bigint;
  /** In base units of the new token: the expected output less the slippage the policy allowed. */
  readonly minOut: bigint;
  /**
   * The create call carries no minimum for the first buy, as its launcher declares (decision
   * 0270): the simulation before the card holds it to `minOut`, and the card says so.
   */
  readonly isUnbound?: true;
}

/**
 * What a token launch's card confirms (decision 0235): every setting the launch runs with, the
 * launchpad's own settings with their defaults filled, the token its create call makes, the
 * launch fee, the first buy, the uploaded picture's digest and the metadata address its create
 * call names, and the pin the engine waits for (decision 0234). A launch keeps it in its `quote`
 * column, so the card's terms hash binds every setting the card shows.
 */
export interface TokenLaunchQuote {
  readonly venue: string;
  readonly settings: readonly LaunchSetting[];
  readonly token: AssetRef;
  readonly tokenDecimals: number;
  /** The launchpad's fee, in the chain's coin. */
  readonly fee: Amount;
  readonly firstBuy?: LaunchFirstBuy;
  readonly image: LaunchImage;
  readonly metadataUri: string;
  /** The launchpad's handle of the pin, which the engine gives back when it asks for it. */
  readonly pin: JsonValue;
  /** When the pin wait ends: a launch with no pin reported by then ends `pin_timeout`. */
  readonly pinWaitUntilMs: number;
  readonly quotedAtMs: number;
}

/** A {@link TokenLaunchQuote} as JSON carries it. */
interface TokenLaunchQuoteWire {
  readonly venue: string;
  readonly settings: readonly LaunchSetting[];
  readonly token: string;
  readonly tokenDecimals: number;
  readonly fee: AmountWire;
  readonly firstBuy?: {
    readonly spend: AmountWire;
    readonly expectedOut: string;
    readonly minOut: string;
    readonly isUnbound?: true;
  };
  readonly image: { readonly contentType: string; readonly bytes: number; readonly sha256: string };
  readonly metadataUri: string;
  readonly pin: JsonValue;
  readonly pinWaitUntilMs: number;
  readonly quotedAtMs: number;
}

const settingSchema: z.ZodType<LaunchSetting, LaunchSetting> = z.strictObject({
  name: z.string(),
  type: z.enum(launchOptionTypes),
  value: z.union([z.number(), z.boolean(), z.string()]),
});

const tokenLaunchQuoteSchema: z.ZodType<TokenLaunchQuote, TokenLaunchQuoteWire> = z.strictObject({
  venue: z.string(),
  settings: z.array(settingSchema),
  token: assetRefSchema,
  tokenDecimals: z.int().min(0).max(36),
  fee: amountSchema,
  firstBuy: z
    .strictObject({
      spend: amountSchema,
      expectedOut: decimalStringSchema,
      minOut: decimalStringSchema,
      isUnbound: z.literal(true).exactOptional(),
    })
    .exactOptional(),
  image: z.strictObject({
    contentType: z.enum(["image/png", "image/jpeg", "image/webp"]),
    bytes: z.int().positive(),
    sha256: sha256HexSchema,
  }),
  metadataUri: z.string().min(1),
  pin: z.json(),
  pinWaitUntilMs: epochMsSchema,
  quotedAtMs: epochMsSchema,
});

/** A token launch's quote, in the `quote` column of its `launchToken` intent. */
export const tokenLaunchQuoteDocument: DocumentCodec<TokenLaunchQuote> = documentCodec(
  "launch quote",
  tokenLaunchQuoteSchema,
);
