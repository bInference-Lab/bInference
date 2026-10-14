import { type AccountRef, accountRefSchema } from "@binference/chain";
import { bpsSchema, decimalStringSchema, type Bps } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** One finding of a risk source, such as `honeypot` from `goplus`. */
export interface RiskFlag {
  readonly code: string;
  readonly source: string;
}

/**
 * A token's risk check: the verdict, the flags behind it, the taxes and liquidity seen, and the
 * wallets the token's launchpad favors.
 */
export interface RiskView {
  readonly verdict: "pass" | "warn" | "block";
  readonly flags: readonly RiskFlag[];
  readonly buyTaxBps?: Bps;
  readonly sellTaxBps?: Bps;
  readonly liquidityUsdMicros?: bigint;
  /**
   * The insider wallets: those the launchpad that launched the token favors over every other
   * buyer, such as wallets its launch exempted from the launch-window tax; at most
   * {@link maxInsiders}, the first the launchpad named.
   */
  readonly insiders?: readonly AccountRef[];
  readonly onCurve: boolean;
  readonly checkedAt: number;
}

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** The most insiders a risk view records, so a launch that exempts thousands stores a few. */
export const maxInsiders = 50;

/** Parses a risk view. */
export const riskViewSchema: z.ZodType<RiskView> = z.object({
  verdict: z.enum(["pass", "warn", "block"]),
  flags: z.array(z.object({ code: codeSchema, source: codeSchema })),
  buyTaxBps: bpsSchema.exactOptional(),
  sellTaxBps: bpsSchema.exactOptional(),
  liquidityUsdMicros: decimalStringSchema.exactOptional(),
  insiders: z.array(accountRefSchema).max(maxInsiders).exactOptional(),
  onCurve: z.boolean(),
  checkedAt: epochMsSchema,
});
