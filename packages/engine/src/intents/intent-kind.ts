/**
 * What an intent does: the request kinds of protocol spec 8.1 but `lend`, which the engine refuses
 * before it stores anything (decision 0296), `rescue`, which only `safety/rescue` creates,
 * `unfreeze`, which only `safety/unfreeze` creates, and `autoOrder`, an auto order's card, which
 * only `order/create` creates (decision 0189). An auto order or webhook rule fill is a `buy`,
 * `sell` or `swap`.
 */
export const intentKinds = [
  "swap",
  "buy",
  "sell",
  "send",
  "revokeApproval",
  "stake",
  "bridge",
  "cexOrder",
  "registerIdentity",
  "launchToken",
  "rescue",
  "unfreeze",
  "autoOrder",
] as const;

/** The kind of an intent. */
export type IntentKind = (typeof intentKinds)[number];
