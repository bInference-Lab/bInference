import { z } from "zod";

const kinds = [
  "swap",
  "buy",
  "sell",
  "send",
  "revokeApproval",
  "lend",
  "stake",
  "bridge",
  "cexOrder",
  "registerIdentity",
  "launchToken",
  "rescue",
] as const;

/**
 * What an intent does: a request kind of `intent/propose`, or `rescue`, which only `safety/rescue`
 * creates. An auto order or webhook rule fill is a `buy`, `sell` or `swap`.
 */
export type IntentKind = (typeof kinds)[number];

/** Parses an intent kind. */
export const intentKindSchema: z.ZodType<IntentKind, string> = z.enum(kinds);
