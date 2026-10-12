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
  "unfreeze",
  "autoOrder",
] as const;

/**
 * What an intent does: a request kind of `intent/propose`, `rescue`, which only `safety/rescue`
 * creates, `unfreeze`, which only `safety/unfreeze` creates, or `autoOrder`, the card of an auto
 * order, which only `order/create` creates. An auto order or webhook rule fill is a `buy`, `sell`
 * or `swap`.
 */
export type IntentKind = (typeof kinds)[number];

/** Parses an intent kind. */
export const intentKindSchema: z.ZodType<IntentKind, string> = z.enum(kinds);
