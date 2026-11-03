import { BinferenceError } from "@binference/core";
import { startNodeProgram } from "@binference/platform";
import { channelLines } from "../channel/channel-lines.js";

/** A Node process started as the engine is, which the probe tries to signal. */
export interface DebugDecoy {
  readonly pid: number;
  /** Whether its debugger opened: `open`, `closed`, or none when it ended first. */
  report(): Promise<"open" | "closed" | undefined>;
  kill(): void;
}

// Answers its first line of input with whether its own debugger is open, then ends. It waits a
// second first: a debugger a signal opens starts on a thread of its own, a moment later.
const decoyProgram = [
  'import inspector from "node:inspector";',
  'process.stdin.once("data", () => setTimeout(() => {',
  '  process.stdout.write(inspector.url() === undefined ? "closed\\n" : "open\\n");',
  "  process.exit(0);",
  "}, 1000));",
].join("\n");

/** The debug-signal switch the engine runs with (decision 0300). */
export const engineDebugSwitch = "--disable-sigusr1";

/**
 * Starts the decoy: `process.execPath` with `--disable-sigusr1`, as every engine process runs, a
 * debugger port of the OS's choosing should one open anyway, and a few lines that report whether
 * its debugger opened. The probe signals it to open its debugger and to stop; neither may work.
 * `nodeOptions` replaces the switch, for a test that proves the decoy sees a debugger open. The
 * signal ends it.
 */
export async function startDebugDecoy(options: {
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  readonly signal: AbortSignal;
  readonly nodeOptions?: readonly string[];
}): Promise<DebugDecoy> {
  const nodeOptions = options.nodeOptions ?? [engineDebugSwitch];
  const program = startNodeProgram({
    args: [...nodeOptions, "--inspect-port=0", "--input-type=module", "--eval", decoyProgram],
    parentEnv: options.parentEnv,
    signal: options.signal,
  });
  const { pid } = program;
  if (pid === undefined) {
    program.kill();
    throw new BinferenceError({
      code: "plugin.decoy_failed",
      message: "The sandbox check's decoy process did not start.",
    });
  }
  const lines = channelLines(program.output, 16);
  return {
    pid,
    report: async () => {
      await program.write("report\n").catch(() => undefined);
      const line = await lines.next();
      return line.done === true || (line.value !== "open" && line.value !== "closed")
        ? undefined
        : line.value;
    },
    kill: () => program.kill(),
  };
}
