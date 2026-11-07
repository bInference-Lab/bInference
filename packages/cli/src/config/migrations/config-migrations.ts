import { valueAt } from "./config-edit.js";
import type { ConfigMigration } from "./migrate-config.js";
import { usdAsText } from "./usd-as-text.js";

const searchProvider: readonly string[] = ["search", "provider"];
const minHealthFactor: readonly string[] = ["defaults", "limits", "minHealthFactor"];
const unbuiltTelegramKeys: readonly (readonly string[])[] = [
  ["telegram", "groups"],
  ["telegram", "confirmBotToken"],
];

/**
 * Every config migration, oldest first: the one at index `n` reads version `n + 1`. A change to
 * the config schema adds one here, and `check:config-schema` fails until it does.
 */
export const configMigrations: readonly ConfigMigration[] = [
  {
    from: 1,
    summary: "Adds chains.maxFeePerGasGwei, the network fee cap of each chain, at its default.",
    edits: () => [],
  },
  {
    from: 2,
    summary: "Adds chains.rpc.<chain>.tracer, the owner's tracing RPC, which no file sets yet.",
    edits: () => [],
  },
  usdAsText,
  {
    from: 4,
    summary: "Adds remote.publicUrl, the HTTPS address of the Mini App, which no file sets yet.",
    edits: () => [],
  },
  {
    from: 5,
    summary:
      "Adds defaults.notifications, a new agent's muted notice kinds and daily summary time, " +
      "at their defaults.",
    edits: () => [],
  },
  {
    from: 6,
    summary:
      "Adds chains.rpc.<chain>.ws, the owner's WebSocket RPC for new blocks, which no file sets yet.",
    edits: () => [],
  },
  {
    from: 7,
    summary:
      'Removes search.provider "duckduckgo", which has no web search API: search_web uses the ' +
      "first of brave and tavily with a key.",
    edits: (file) =>
      valueAt(file, searchProvider) === "duckduckgo"
        ? [{ kind: "remove", path: searchProvider }]
        : [],
  },
  {
    from: 8,
    summary:
      "Adds models.imageInput, the models that take images as input, empty: images go to " +
      "models.vision until a model is listed.",
    edits: () => [],
  },
  {
    from: 9,
    summary:
      "Lets defaults.notifications mute alertHeld, the line that tells an alert's matches its " +
      "notice hour held back; no file names it yet.",
    edits: () => [],
  },
  {
    from: 10,
    summary:
      "Removes defaults.limits.minHealthFactor: binference does not lend or borrow, so no limit " +
      "holds a health factor.",
    edits: (file) =>
      valueAt(file, minHealthFactor) === undefined
        ? []
        : [{ kind: "remove", path: minHealthFactor }],
  },
  {
    from: 11,
    summary: "Adds venues.keys.relay, the owner's Relay API key, which no file sets yet.",
    edits: () => [],
  },
  {
    from: 12,
    summary:
      "Lets defaults.notifications mute claimReady, the notice that an unstake's coin can be " +
      "claimed; no file names it yet.",
    edits: () => [],
  },
  {
    from: 13,
    summary:
      "Removes telegram.groups and telegram.confirmBotToken, which no part of binference read: " +
      "the bot answers only the owner's private chat. They return with the work that builds them.",
    edits: (file) =>
      unbuiltTelegramKeys
        .filter((path) => valueAt(file, path) !== undefined)
        .map((path) => ({ kind: "remove", path })),
  },
  {
    from: 14,
    summary:
      'Adds telegram.replies.stream, how the agent\'s replies show while it works, at "progress": ' +
      "a status message once the agent works, then the answer as a new message.",
    edits: () => [],
  },
  {
    from: 15,
    summary:
      'Adds telegram.replies.reasoning, how the model\'s reasoning shows in Telegram, at "off": ' +
      "the owner sees no reasoning until they choose to.",
    edits: () => [],
  },
  {
    from: 16,
    summary:
      'Adds shell, the agent\'s commands on this machine, at run "any" with a 1800-second limit: ' +
      "the agent runs commands away from binference's own folder until the owner sets off.",
    edits: () => [],
  },
  {
    from: 17,
    summary:
      "Adds files, where the agent's file tools reach: reads, writes and edits anywhere but " +
      "binference's own folder (workspaceOnly false), and patches inside the workspace " +
      "(patchWorkspaceOnly true).",
    edits: () => [],
  },
  {
    from: 18,
    summary:
      "Lets a secret source name a credential stored in the engine, { fromCredential: NAME }; " +
      "no file names one yet.",
    edits: () => [],
  },
  {
    from: 19,
    summary:
      "Adds models.imageMaking, the model that makes the agent's images, unset: the agent makes " +
      "none until the owner names one.",
    edits: () => [],
  },
];

/** The version of `config.json5` this binference writes and reads. */
export const currentConfigVersion: number = configMigrations.length + 1;
