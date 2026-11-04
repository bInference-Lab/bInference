import type { ServiceDefinition, ServiceManager } from "@binference/platform";
import { createMemoryServiceManager } from "@binference/platform/testing";

/** How a test's service manager runs the one installed service's program. */
export interface ProgramRuns {
  /** Runs the installed definition's program; resolves once it runs. */
  start(definition: ServiceDefinition): Promise<void>;
  /** Ends the program that runs, if any, and waits until it ended. */
  end(): Promise<void>;
  isRunning(): boolean;
  /** Forgets the definition once the service is removed. */
  forget(): void;
}

/**
 * A service manager for tests over the memory service manager, which checks every definition and
 * name as the OS's own managers do, running the installed service's program through `runs`: an
 * install ends the program that runs and starts the new one, a stop or an uninstall ends it and
 * waits, and the status says whether it runs.
 */
export function createProgramServices(runs: ProgramRuns): ServiceManager {
  const memory = createMemoryServiceManager();
  return {
    install: async (definition, signal) => {
      await memory.install(definition, signal);
      await runs.end();
      await runs.start(definition);
    },
    stop: async (name, signal) => {
      const stopped = await memory.stop(name, signal);
      await runs.end();
      return stopped;
    },
    uninstall: async (name, signal) => {
      const removed = await memory.uninstall(name, signal);
      await runs.end();
      runs.forget();
      return removed;
    },
    status: async (name, signal) => {
      const status = await memory.status(name, signal);
      if (status.state === "not_installed") {
        return status;
      }
      return { ...status, state: runs.isRunning() ? "running" : "stopped" };
    },
  };
}
