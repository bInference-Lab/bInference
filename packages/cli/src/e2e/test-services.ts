import type { EventEmitter } from "node:events";
import { BinferenceError } from "@binference/core";
import type { ServiceDefinition, ServiceManager } from "@binference/platform";
import { createMemoryServiceManager } from "@binference/platform/testing";
import { runCli } from "../program/run-cli.js";
import type { TestHost } from "./test-host.js";

/**
 * A service manager that runs a service's `binference` command line in this process, as the OS
 * runs the program at login, so no test touches the machine's login items.
 */
export interface TestServices {
  /** The service manager to give the host. */
  readonly manager: ServiceManager;
  /** The definition installed last, or `undefined` before the first install. */
  readonly installed: () => ServiceDefinition | undefined;
  /** How many times a definition was installed. */
  readonly installs: () => number;
  /** Runs the installed service as the OS does at the owner's next login. */
  readonly login: () => Promise<void>;
  /** Ends the program that runs, as a logout does, and keeps the service. */
  readonly logout: () => Promise<void>;
}

/** What the service's command line runs on. */
export interface TestServicesOptions {
  /** The entry script in the definition's arguments; the command line follows it. */
  readonly script: string;
  /** A host on the test machine for the service's command line. */
  readonly host: (argv: readonly string[]) => TestHost;
  /** The machine's stop signals, which end the program as a logout does. */
  readonly signals: EventEmitter;
}

// The line `binference start --foreground` prints once the engine serves.
const readyLine = "binference is running";

function failedAtStart(): BinferenceError {
  return new BinferenceError({
    code: "platform.service_failed",
    message: "The service's program ended as it started; read its log file.",
  });
}

interface Running {
  definition?: ServiceDefinition;
  exit?: Promise<number>;
  installs: number;
}

// The program's runs: one at a time, each started from the installed definition.
function createRuns(options: TestServicesOptions) {
  const state: Running = { installs: 0 };
  const end = async (): Promise<void> => {
    const { exit } = state;
    if (exit !== undefined) {
      options.signals.emit("SIGINT", "SIGINT");
      await exit;
    }
  };
  const run = async (): Promise<void> => {
    const args = state.definition?.args ?? [];
    const host = options.host(args.slice(args.indexOf(options.script) + 1));
    const exit = runCli(host);
    state.exit = exit;
    void exit.finally(() => {
      if (state.exit === exit) {
        delete state.exit;
      }
    });
    const ready = host.waitForLine((line) => line.startsWith(readyLine)).then(() => true);
    if (!(await Promise.race([ready, exit.then(() => false)]))) {
      throw failedAtStart();
    }
  };
  return { state, end, run };
}

/**
 * Creates {@link TestServices}: an install ends the program that runs, runs the new command line
 * and resolves once it says the engine serves, or fails as the OS does when it ends at once; a
 * stop or an uninstall ends it with a stop signal and waits until it ends.
 */
export function createTestServices(options: TestServicesOptions): TestServices {
  const memory = createMemoryServiceManager();
  const { state, end, run } = createRuns(options);
  const manager: ServiceManager = {
    install: async (definition, signal) => {
      await end();
      await memory.install(definition, signal);
      state.definition = definition;
      state.installs += 1;
      await run();
    },
    stop: async (name, signal) => {
      const stopped = await memory.stop(name, signal);
      await end();
      return stopped;
    },
    uninstall: async (name, signal) => {
      const removed = await memory.uninstall(name, signal);
      await end();
      delete state.definition;
      return removed;
    },
    status: async (name, signal) => {
      const status = await memory.status(name, signal);
      if (status.state === "not_installed") {
        return status;
      }
      return { ...status, state: state.exit === undefined ? "stopped" : "running" };
    },
  };
  return {
    manager,
    installed: () => state.definition,
    installs: () => state.installs,
    login: run,
    logout: end,
  };
}
