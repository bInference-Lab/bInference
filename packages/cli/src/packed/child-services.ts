import process from "node:process";
import {
  type NodeProgram,
  type ServiceDefinition,
  type ServiceManager,
  startNodeProgram,
} from "@binference/platform";
import { createProgramServices } from "../e2e/program-services.js";

/** What each program the services start gets. */
interface ChildServicesOptions {
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly env: Readonly<Record<string, string>>;
}

// How long a stopped program has to end before it is killed: the engine's shutdown budget.
const stopWaitMs = 40_000;

// Reads what the program writes, so its output never fills the pipe and holds it.
async function drain(program: NodeProgram): Promise<void> {
  for await (const piece of program.output) {
    void piece;
  }
}

// The one service's program: one at a time, each started from the definition installed. A stop
// sends `SIGTERM`, as launchd and systemd do, and kills the program past the shutdown budget.
function createRuns(options: ChildServicesOptions) {
  const state: { program?: NodeProgram } = {};
  const end = async (): Promise<void> => {
    const { program } = state;
    if (program === undefined) {
      return;
    }
    if (program.pid !== undefined) {
      process.kill(program.pid, "SIGTERM");
    }
    const killed = setTimeout(() => program.kill(), stopWaitMs);
    await program.exited;
    clearTimeout(killed);
    delete state.program;
  };
  const start = (definition: ServiceDefinition): void => {
    const program = startNodeProgram({
      args: definition.args,
      parentEnv: options.parentEnv,
      env: options.env,
      signal: new AbortController().signal,
    });
    void drain(program);
    state.program = program;
    void program.exited.finally(() => {
      if (state.program === program) {
        delete state.program;
      }
    });
  };
  return { state, end, start };
}

/**
 * A service manager for the update smoke: it keeps the definitions as the memory service manager
 * does, which checks them as the OS's own managers do, and runs the installed service's command
 * line as a child process of this Node with the variables given, never touching the machine's
 * login items. Installing ends the program that runs and starts the new one.
 */
export function createChildServices(options: ChildServicesOptions): ServiceManager {
  const { state, end, start } = createRuns(options);
  return createProgramServices({
    start: async (definition) => {
      start(definition);
      return Promise.resolve();
    },
    end,
    isRunning: () => state.program !== undefined,
    forget: () => undefined,
  });
}
