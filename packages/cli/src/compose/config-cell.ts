import type { BinferenceConfig } from "../config/schema/config.schema.js";

/**
 * The config the running engine reads on each use, for the keys whose parts follow a reload of
 * `config.json5` (decision 0118). A part that copies a key at start reads `Opened.config` instead,
 * and its key applies after a restart.
 */
export interface ConfigCell {
  /** The config the engine started with: what a part that copies a key at start holds. */
  readonly started: BinferenceConfig;
  current(): BinferenceConfig;
  /** Puts a config read again in place; the next read of any key sees it. */
  replace(next: BinferenceConfig): void;
}

/** Creates a {@link ConfigCell} holding the config the engine started with. */
export function createConfigCell(initial: BinferenceConfig): ConfigCell {
  const cell = { config: initial };
  return {
    started: initial,
    current: () => cell.config,
    replace: (next) => {
      cell.config = next;
    },
  };
}
