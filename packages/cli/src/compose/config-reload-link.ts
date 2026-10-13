import type { ConfigAuthor } from "@binference/engine/audit";

/** Who wrote a change to `config.json5` that the reload applies, and why. */
export interface ReloadAuthor {
  readonly author: ConfigAuthor;
  readonly reason?: string;
}

/**
 * The reload path a writer of `config.json5` hands its change to (decision 0118): `applyNow`
 * reloads at once, after any reload under way, and journals each changed key with the writer as
 * its author. Before the reload starts it does nothing, and the watch picks the change up.
 */
export interface ConfigReloadLink {
  applyNow: (by: ReloadAuthor, signal: AbortSignal) => Promise<void>;
}

/** A {@link ConfigReloadLink} that does nothing until a started reload takes its place. */
export function createConfigReloadLink(): ConfigReloadLink {
  return { applyNow: async () => Promise.resolve() };
}
