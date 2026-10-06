import { bpsSchema, decimalStringSchema, type Bps } from "@binference/core";
import { z } from "zod";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** One finding of a risk source, such as `honeypot` from `goplus`. */
export interface RiskFlag {
  readonly code: string;
  readonly source: string;
}

/** A token's risk check: the verdict, the flags behind it, and the taxes and liquidity seen. */
export interface RiskView {
  readonly verdict: "pass" | "warn" | "block";
  readonly flags: readonly RiskFlag[];
  readonly buyTaxBps?: Bps;
  readonly sellTaxBps?: Bps;
  readonly liquidityUsdMicros?: bigint;
  readonly onCurve: boolean;
  readonly checkedAt: number;
}

const codeSchema = z.string().regex(/^[a-z][a-z0-9_]*$/);

/** Parses a risk view. */
export const riskViewSchema: z.ZodType<RiskView> = z.object({
  verdict: z.enum(["pass", "warn", "block"]),
  flags: z.array(z.object({ code: codeSchema, source: codeSchema })),
  buyTaxBps: bpsSchema.exactOptional(),
  sellTaxBps: bpsSchema.exactOptional(),
  liquidityUsdMicros: decimalStringSchema.exactOptional(),
  onCurve: z.boolean(),
  checkedAt: epochMsSchema,
});
