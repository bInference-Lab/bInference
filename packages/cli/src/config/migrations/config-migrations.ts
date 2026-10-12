import type { ConfigMigration } from "./migrate-config.js";
import { usdAsText } from "./usd-as-text.js";

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
];

/** The version of `config.json5` this binference writes and reads. */
export const currentConfigVersion: number = configMigrations.length + 1;
