import type { Clock, WorkspaceFiles } from "../ports.js";
import { err, ok } from "../result.js";
import type { WorkspacePlace, WorkspaceText } from "../workspace/workspace-place.js";
import { checkWorkspacePlace } from "../workspace/workspace-place.js";

async function start(place: WorkspacePlace, signal: AbortSignal): Promise<string> {
  checkWorkspacePlace(place);
  signal.throwIfAborted();
  await Promise.resolve();
  return `${place.agent}/${place.file}`;
}

/**
 * Creates a {@link WorkspaceFiles} for tests that keeps each file in memory, stamped with the
 * clock's time when written. It checks names as every store does.
 */
export function createMemoryWorkspaceFiles(clock: Clock): WorkspaceFiles {
  const held = new Map<string, WorkspaceText>();
  const put = (key: string, text: string): number => {
    const updatedAtMs = clock.now();
    held.set(key, { text, updatedAtMs });
    return updatedAtMs;
  };
  return {
    read: async (place, signal) => {
      const found = held.get(await start(place, signal));
      return found === undefined ? err("not_found") : ok(found);
    },
    write: async (place, text, signal) => put(await start(place, signal), text),
    create: async (place, text, signal) => {
      const key = await start(place, signal);
      return held.has(key) ? err("exists") : ok(put(key, text));
    },
  };
}
