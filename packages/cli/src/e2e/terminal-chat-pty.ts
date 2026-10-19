import { stripVTControlCharacters } from "node:util";
import { type IPty, spawn } from "node-pty";

/** `binference chat` in a pseudo-terminal of its own, and what the test types and reads. */
export interface PtyChat {
  /** Types keys, as a person at the terminal does. */
  type(keys: string): void;
  /** Resolves once the screen holds the text; rejects with the screen after 20 seconds. */
  shows(text: string): Promise<void>;
  /** Everything the program wrote so far, without its control sequences. */
  screen(): string;
  /** Resolves with the program's exit code. */
  readonly exited: Promise<number>;
  /** Ends the program at once, if it still runs. */
  kill(): void;
}

/** What one chat starts from. */
export interface PtyChatOptions {
  /** The entry file, `src/main.ts`. */
  readonly main: string;
  readonly args: readonly string[];
  /** The test process's environment, which the program gets with `env` on top. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly env: Readonly<Record<string, string>>;
  readonly cwd: string;
}

// How long a wait for the screen lasts before the test fails with what the screen showed.
const showsWithinMs = 20_000;

function environment(options: PtyChatOptions): Record<string, string> {
  const merged = { ...options.parentEnv, ...options.env };
  return Object.fromEntries(
    Object.entries(merged).flatMap(([name, value]) => (value === undefined ? [] : [[name, value]])),
  );
}

/** Waits for text on a screen that grows, and fails every wait at once with why. */
interface ScreenWaits {
  readonly add: (text: string, resolve: () => void, reject: (error: Error) => void) => void;
  readonly seen: (screen: string) => void;
  readonly fail: (error: Error) => void;
}

function screenWaits(): ScreenWaits {
  const waiters = new Set<{
    readonly text: string;
    readonly resolve: () => void;
    readonly reject: (error: Error) => void;
  }>();
  return {
    add: (text, resolve, reject) => waiters.add({ text, resolve, reject }),
    seen: (screen) => {
      [...waiters]
        .filter((waiter) => screen.includes(waiter.text))
        .forEach((waiter) => {
          waiters.delete(waiter);
          waiter.resolve();
        });
    },
    fail: (error) => {
      waiters.forEach((waiter) => waiter.reject(error));
      waiters.clear();
    },
  };
}

/**
 * Runs the CLI from source in a pseudo-terminal 100 columns wide and 30 rows high through
 * node-pty, so standard input and output are a terminal as on an owner's machine: ConPTY on
 * Windows, a pty on macOS and Linux.
 */
export function startPtyChat(options: PtyChatOptions): PtyChat {
  const program: IPty = spawn(
    process.execPath,
    ["--conditions=@binference/source", "--import", "tsx", options.main, ...options.args],
    { name: "xterm-256color", cols: 100, rows: 30, cwd: options.cwd, env: environment(options) },
  );
  const state = { written: "" };
  const waits = screenWaits();
  const screen = (): string => stripVTControlCharacters(state.written);
  const fail = (why: string): void => waits.fail(new Error(`${why} It showed:\n${screen()}`));
  program.onData((data) => {
    state.written += data;
    waits.seen(screen());
  });
  const exited = new Promise<number>((resolve) => {
    program.onExit(({ exitCode }) => {
      fail(`The chat ended with ${String(exitCode)}.`);
      resolve(exitCode);
    });
  });
  return {
    type: (keys) => program.write(keys),
    shows: async (text) =>
      screen().includes(text)
        ? Promise.resolve()
        : new Promise<void>((resolve, reject) => {
            waits.add(text, resolve, reject);
            AbortSignal.timeout(showsWithinMs).addEventListener("abort", () => {
              fail(`The chat never showed ${text}.`);
            });
          }),
    screen,
    exited,
    kill: () => {
      try {
        program.kill();
      } catch {
        // The program has ended already.
      }
    },
  };
}
