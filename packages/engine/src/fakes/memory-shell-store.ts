import type { ShellStore } from "../shell/ports.js";
import type { AllowedCommandRecord, ShellWatchRecord } from "../shell/shell-records.js";

// What makes two allowed commands the same: their program, arguments and folder.
function keyOf(command: AllowedCommandRecord): string {
  return JSON.stringify([command.program, command.args, command.folder]);
}

function isSame(a: AllowedCommandRecord, b: AllowedCommandRecord): boolean {
  return keyOf(a) === keyOf(b);
}

/**
 * The shell's rows in memory, for tests (decision 0409): allowed commands in the order they were
 * kept, one per program, arguments and folder, and the watched jobs, each once. It follows
 * {@link ShellStore} and passes its contract suite.
 */
export function createMemoryShellStore(): ShellStore {
  const allowed: AllowedCommandRecord[] = [];
  const watches = new Map<string, ShellWatchRecord>();
  return {
    allowed: async () => Promise.resolve([...allowed]),
    allow: async (commands) => {
      const kept = commands.filter(
        (command, at) =>
          !allowed.some((each) => isSame(each, command)) &&
          !commands.slice(0, at).some((each) => isSame(each, command)),
      );
      allowed.push(...kept);
      return Promise.resolve(kept);
    },
    disallow: async (id) => {
      const at = allowed.findIndex((each) => each.id === id);
      return Promise.resolve(at < 0 ? undefined : allowed.splice(at, 1)[0]);
    },
    watch: async (watch) => {
      if (!watches.has(watch.job)) {
        watches.set(watch.job, watch);
      }
      return Promise.resolve();
    },
    unwatch: async (job) => Promise.resolve(watches.delete(job)),
    watched: async () =>
      Promise.resolve([...watches.values()].toSorted((a, b) => a.startedAtMs - b.startedAtMs)),
  };
}
