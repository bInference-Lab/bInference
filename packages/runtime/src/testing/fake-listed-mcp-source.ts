import type { ListedMcpServer } from "../listed-mcp/listing.schema.js";
import type { ListedMcpSource } from "../listed-mcp/ports.js";

/** A {@link ListedMcpSource} in memory, whose listings a test puts in force with `set`. */
export interface FakeListedMcpSource extends ListedMcpSource {
  /** Replaces the listings in force and calls every watcher. */
  set(next: readonly ListedMcpServer[]): void;
}

/** Creates a {@link FakeListedMcpSource} holding `initial`, as a catalog read once would. */
export function createFakeListedMcpSource(
  initial: readonly ListedMcpServer[] = [],
): FakeListedMcpSource {
  let servers = initial;
  const watchers = new Set<() => void>();
  return {
    current: () => servers,
    watch(listener) {
      // A watcher is kept by its own entry, so one function watched twice is heard twice.
      const entry = (): void => listener();
      watchers.add(entry);
      return () => watchers.delete(entry);
    },
    set(next) {
      servers = next;
      for (const watcher of watchers) {
        watcher();
      }
    },
  };
}
