import {
  type AccountRef,
  accountRefSchema,
  type Amount,
  amountSchema,
  type AssetRef,
  assetRefSchema,
  type ChainRef,
  chainRefSchema,
} from "@binference/chain";
import { type Bps, bpsSchema, decimalStringSchema, type Ratio } from "@binference/core";
import { z } from "zod";
import { protocolIdSchema, type ProtocolId } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { venueIdSchema } from "../values/plain-id.schema.js";
import { signedIntegerSchema, signedUsdMicrosSchema } from "../values/signed-usd-micros.schema.js";
import { type AssetInfos, assetInfosSchema } from "./asset-info.schema.js";
import type { RouteLeg } from "./quote-view.schema.js";

/**
 * One argument of a card line, typed so every surface formats it with the one formatter (spec 4,
 * section 3): an amount with its symbol, USD, a time or a day and time in the owner's timezone. `text` is set by
 * someone else (the agent, a token's deployer, a venue), so a surface escapes it and cuts it.
 * `choice` is the value of an ICU `select`, `count` of an ICU `plural`. `usdChange` and
 * `percentChange` are a gain or a loss, shown with their sign (spec 4, section 3.7).
 */
export type CardValueView =
  | { readonly type: "amount"; readonly amount: Amount }
  | { readonly type: "asset"; readonly asset: AssetRef }
  | { readonly type: "account"; readonly account: AccountRef }
  | { readonly type: "chain"; readonly chain: ChainRef }
  | { readonly type: "usd"; readonly usdMicros: bigint }
  | { readonly type: "percent"; readonly bps: Bps }
  | { readonly type: "ratio"; readonly ratio: Ratio }
  | { readonly type: "time"; readonly atMs: number }
  | { readonly type: "count"; readonly count: number }
  | { readonly type: "choice"; readonly choice: string }
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "route"; readonly venue: string; readonly legs: readonly RouteLeg[] }
  | { readonly type: "line"; readonly line: CardLineView }
  /** A day and a time of day in the owner's timezone, such as an auto order's expiry. */
  | { readonly type: "dateTime"; readonly atMs: number }
  /** A gain or a loss in micro-dollars, below zero for a loss: `+$2.40`, `-$0.85`. */
  | { readonly type: "usdChange"; readonly usdMicros: bigint }
  /** A gain or a loss in basis points of its base, any size, below zero for a loss: `+20.34%`. */
  | { readonly type: "percentChange"; readonly bps: bigint };

/** One line of a card as data: a message key of the `card` areas and its arguments. */
export interface CardLineView {
  readonly key: string;
  readonly values: Readonly<Record<string, CardValueView>>;
}

/** A card version as the engine draws it, line by line, with every asset it names. */
export interface CardLinesView {
  readonly card: ProtocolId<"card">;
  /** The version a Confirm names; a worse re-quote opens the next one. */
  readonly version: number;
  readonly expiresAt: number;
  readonly lines: readonly CardLineView[];
  readonly assets: AssetInfos;
}

const tag = <T extends string>(type: T) => ({ type: z.literal(type) });

const argumentName = z.string().regex(/^[a-zA-Z][a-zA-Z0-9]{0,31}$/);

/** Parses a card line; its values parse as {@link CardValueView}. */
export const cardLineViewSchema: z.ZodType<CardLineView> = z.lazy(() =>
  z.object({
    key: z.string().regex(/^[a-zA-Z][\w.]{0,63}$/),
    values: z.record(argumentName, cardValueViewSchema),
  }),
);

/** Parses one argument of a card line. */
export const cardValueViewSchema: z.ZodType<CardValueView> = z.discriminatedUnion("type", [
  z.object({ ...tag("amount"), amount: amountSchema }),
  z.object({ ...tag("asset"), asset: assetRefSchema }),
  z.object({ ...tag("account"), account: accountRefSchema }),
  z.object({ ...tag("chain"), chain: chainRefSchema }),
  z.object({ ...tag("usd"), usdMicros: signedUsdMicrosSchema }),
  z.object({ ...tag("percent"), bps: bpsSchema }),
  z.object({
    ...tag("ratio"),
    ratio: z.object({ numerator: decimalStringSchema, denominator: decimalStringSchema }),
  }),
  z.object({ ...tag("time"), atMs: epochMsSchema }),
  z.object({ ...tag("count"), count: z.int() }),
  z.object({ ...tag("choice"), choice: z.string().max(64) }),
  z.object({ ...tag("text"), text: z.string().max(4096) }),
  z.object({
    ...tag("route"),
    venue: z.string().max(64),
    legs: z.array(z.object({ venue: venueIdSchema, shareBps: bpsSchema })),
  }),
  z.object({ ...tag("line"), line: cardLineViewSchema }),
  z.object({ ...tag("dateTime"), atMs: epochMsSchema }),
  z.object({ ...tag("usdChange"), usdMicros: signedUsdMicrosSchema }),
  z.object({ ...tag("percentChange"), bps: signedIntegerSchema }),
]);

/** Parses a card version as the engine draws it. */
export const cardLinesViewSchema: z.ZodType<CardLinesView> = z.object({
  card: protocolIdSchema("card"),
  version: z.int().min(1),
  expiresAt: epochMsSchema,
  lines: z.array(cardLineViewSchema),
  assets: assetInfosSchema,
});
