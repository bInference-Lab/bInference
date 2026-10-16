import type { InitContext } from "./init-context.js";

/** Whether a `--set` flag gives the config key at `path`, so init asks nothing for it. */
export function isSetByFlag(context: InitContext, path: readonly string[]): boolean {
  const key = `${path.join(".")}=`;
  return context.flags.sets.some((set) => set.startsWith(key));
}
