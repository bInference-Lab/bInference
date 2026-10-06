import { z } from "zod";
import type { Brand } from "../brand.js";

/** An integer rate in basis points, 0 to 10,000: `50` is 0.5%. */
export type Bps = Brand<number, "Bps">;

/** Basis points in a whole: 10,000 is 100%. */
export const bpsPerWhole = 10_000;

/** Whether a number is an integer rate from 0 to 10,000 basis points. */
export function isBps(value: number): value is Bps {
  return Number.isInteger(value) && value >= 0 && value <= bpsPerWhole;
}

/** Parses an integer rate in basis points, 0 to 10,000. */
export const bpsSchema: z.ZodType<Bps, number> = z.number().refine(isBps, {
  message: "Expected an integer from 0 to 10000 basis points.",
});
