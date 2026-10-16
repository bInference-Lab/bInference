import { chainRefSchema } from "@binference/chain";
import type { JsonValue } from "@binference/core";
import { gweiToWei, isGweiText } from "./gwei-to-wei.js";
import type { BinferenceConfig } from "./schema/config.schema.js";

/** When a change to a config key takes effect: at once, or once binference restarts. */
export type ApplyTime = "now" | "restart";

/** One changed key as the table judges it. */
export interface KeyChange {
  /** The key's path, such as `chains.maxFeePerGasGwei.eip155:56`. */
  readonly path: string;
  /** Its new value; absent once the key is gone. */
  readonly after?: JsonValue;
}

// The keys whose parts copy them once, as binference starts: a change waits for a restart. A key
// that matches no entry of any list here is judged the same way. A `*` stands for one segment,
// such as a chain; an entry covers every key below it.
const restartOnlyKeys: readonly string[] = [
  "version",
  "engine.port",
  "engine.webhookPort",
  "engine.unlock",
  // The OS service manager's wait for the engine's exit is written when `binference start`
  // installs the service, so a longer budget only holds once the service is installed again.
  "engine.shutdownBudgetMs",
  "custody",
  "telegram.botToken",
  "telegram.mode",
  "telegram.webhookSecret",
  "telegram.confirmBotToken",
  // Paper balances and new wallets' ceilings are read from them at start.
  "defaults",
  "chains.enabled",
  "chains.rpc.*.tracer",
  "chains.rpc.*.ws",
  "remote.publicUrl",
  "network",
  "cex",
];

// The keys whose parts read them from the config cell on each use: a change reaches the next use.
const keysReadOnUse: readonly string[] = [
  "owner",
  "logging.level",
  "backups",
  "telegram.topicsPerAgent",
  // The runtime gets them again in its settings, applied from its next model call.
  "models",
  "search",
  "chats.newMessageMode",
  // Each RPC request asks the endpoints config names when it starts.
  "chains.rpc.*.urls",
  // An intent run reads its chain's relays when it starts and keeps them to its end.
  "chains.relays",
];

// The keys spec 2 marks live that no part reads yet, so no running part holds an older value: the
// part that comes for one reads it on each use.
const keysNoPartReads: readonly string[] = [
  "telegram.groups",
  "chains.rpc.*.key",
  "venues.keys.oneinch",
  "venues.keys.zerox",
  "remote.mini",
  "remote.webhooks",
  "updates",
  "telemetry",
  "chats.keepDays",
  "plugins",
];

// The keys spec 2 marks live whose parts still copy them at start: a change waits for a restart
// until its part reads the config cell on each use.
const keysCopiedAtStart: readonly string[] = [
  "engine.extraOrigins",
  "venues.keys.okx",
  "venues.kyberClientId",
  "risk",
  "logging.keepDays",
  "logging.maxFileMb",
];

type Judge = (change: KeyChange, started: BinferenceConfig) => ApplyTime;

const now: Judge = () => "now";
const restart: Judge = () => "restart";

// A chain's fee cap applies to the next intent run while it is at most the cap the engine started
// with: the signer checks every transaction against that one until a restart.
const feeCapWithinStart: Judge = (change, started) => {
  const chain = chainRefSchema.safeParse(change.path.split(".").at(-1));
  if (!chain.success || typeof change.after !== "string" || !isGweiText(change.after)) {
    return "restart";
  }
  const startedCap = started.chains.maxFeePerGasGwei[chain.data];
  const isWithin =
    startedCap !== undefined &&
    gweiToWei(change.after, chain.data) <= gweiToWei(startedCap, chain.data);
  return isWithin ? "now" : "restart";
};

// The keys that apply now only while they stay within what the engine started with.
const keysBoundByStart: readonly (readonly [string, Judge])[] = [
  ["chains.maxFeePerGasGwei.*", feeCapWithinStart],
];

// The table, every entry with its judge; the longest entry that covers a key decides.
const entries: readonly (readonly [string, Judge])[] = [
  ...restartOnlyKeys.map((key) => [key, restart] as const),
  ...keysCopiedAtStart.map((key) => [key, restart] as const),
  ...keysReadOnUse.map((key) => [key, now] as const),
  ...keysNoPartReads.map((key) => [key, now] as const),
  ...keysBoundByStart,
];

function covers(entry: string, path: readonly string[]): boolean {
  const parts = entry.split(".");
  return (
    parts.length <= path.length && parts.every((part, at) => part === "*" || part === path[at])
  );
}

/**
 * When a change to the key takes effect (decision 0230): `now` once its part reads it on each
 * use, else `restart`. Some keys apply now only while they stay within what the running engine
 * started with; a key no entry covers waits for a restart, so a notice never claims a change that
 * did not happen.
 */
export function applyTimeOf(change: KeyChange, started: BinferenceConfig): ApplyTime {
  const path = change.path.split(".");
  const found = entries
    .filter(([entry]) => covers(entry, path))
    .toSorted(([left], [right]) => right.split(".").length - left.split(".").length);
  const [best] = found;
  return best === undefined ? "restart" : best[1](change, started);
}

/** Every entry of the table, for the check that each config key has one. */
export function applyTimeEntries(): readonly string[] {
  return entries.map(([entry]) => entry);
}
