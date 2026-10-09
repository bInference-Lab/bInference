/**
 * What an intent does: the request kinds of protocol spec 8.1, `rescue`, which only `safety/rescue`
 * creates, and `unfreeze`, which only `safety/unfreeze` creates. An auto order or webhook rule fill
 * is a `buy`, `sell` or `swap`.
 */
export const intentKinds = [
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
] as const;

/** The kind of an intent. */
export type IntentKind = (typeof intentKinds)[number];
