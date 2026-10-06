import { z } from "zod";

/** Parses a label the owner gives a wallet, a saved address, a token or a Binance Agent. */
export const labelSchema: z.ZodType<string, string> = z.string().min(1).max(64);
