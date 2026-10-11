import type { StartLine } from "../control/control-line.schema.js";
import { runRuntime } from "../process/run-runtime.js";
import { createByteChannel } from "./byte-channel.js";

/**
 * The runtime run in the test's own process, held as the engine holds the real one: its standard
 * input, its standard output, how it ended, and a kill. `tick` makes it write its health now.
 */
export interface InProcessRuntime {
  write(text: string): Promise<void>;
  end(): Promise<void>;
  readonly output: AsyncIterable<Uint8Array>;
  /** Its exit code: 0 after a stop, 1 after a fault, `undefined` after a kill. */
  readonly exited: Promise<number | undefined>;
  kill(): void;
  /** Runs the 10-second timer's work now, as the timer would. */
  tick(): Promise<void>;
  /** Every start line it signed in with. */
  readonly starts: readonly StartLine[];
}

/** How an in-process runtime differs from one that signs in at once. */
export interface InProcessRuntimeOptions {
  /** Its sign-in fails, as the engine refuses an unknown token. */
  readonly refusesSignIn?: boolean;
  /** Its sign-in never ends, so it never writes `ready`. */
  readonly hangsAtSignIn?: boolean;
}

/** Starts the runtime's main loop in this process, on channels in place of pipes. */
export function startInProcessRuntime(options: InProcessRuntimeOptions = {}): InProcessRuntime {
  const input = createByteChannel();
  const output = createByteChannel();
  const timer = { onTick: async (): Promise<void> => Promise.resolve() };
  const starts: StartLine[] = [];
  const killed = { exited: (_code: number | undefined): void => undefined };
  const exited = new Promise<number | undefined>((resolve) => {
    killed.exited = resolve;
  });
  const running = runRuntime({
    input,
    write: async (line) => output.push(`${line}\n`),
    connect: async (start, signal) => {
      starts.push(start);
      if (options.hangsAtSignIn === true) {
        await new Promise((_, reject) => signal.addEventListener("abort", reject, { once: true }));
      }
      if (options.refusesSignIn === true) {
        throw new Error("The engine refused the token.");
      }
      return { close: () => undefined };
    },
    everyTenSeconds: (onTick, signal) => {
      timer.onTick = onTick;
      signal.addEventListener("abort", () => (timer.onTick = async () => Promise.resolve()), {
        once: true,
      });
    },
    version: "test",
  });
  void running.then(
    (exit) => killed.exited(exit === "stopped" ? 0 : 1),
    () => killed.exited(1),
  );
  void exited.then(() => output.end());
  return {
    write: async (text) => input.push(text),
    end: async () => input.end(),
    output,
    exited,
    kill() {
      input.end();
      killed.exited(undefined);
    },
    tick: async () => timer.onTick(),
    starts,
  };
}
