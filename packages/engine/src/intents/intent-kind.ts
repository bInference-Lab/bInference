/**
 * What an intent does: the request kinds of protocol spec 8.1 but `lend`, which the engine refuses
 * before it stores anything (decision 0296), `rescue`, which only `safety/rescue` creates,
 * `unfreeze`, which only `safety/unfreeze` creates, `autoOrder`, an auto order's card, which only
 * `order/create` creates (decision 0189), and `webhookRule`, a webhook rule's card, which only
 * `webhookRule/create` creates (decision 0299), and `configChange`, a change of the config, which
 * only `config/propose` creates (decision 0393). An auto order or webhook rule fill is a `buy`,
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
  "webhookRule",
  "configChange",
] as const;

/** The kind of an intent. */
export type IntentKind = (typeof intentKinds)[number];

const cardOnlyKinds: ReadonlySet<IntentKind> = new Set<IntentKind>([
  "autoOrder",
  "webhookRule",
  "configChange",
]);

/**
 * Whether an intent is only a card, with no step: an auto order's (decision 0189), a webhook
 * rule's (decision 0299) or a config change's (decision 0393). Its Confirm starts the order or the
 * rule, which fills later on its own, or applies the change.
 */
export function isCardOnlyKind(kind: IntentKind): boolean {
  return cardOnlyKinds.has(kind);
}
