import { startNodeProgram } from "@binference/platform";
import { type SourceProgram, watchProgramLines } from "../e2e/source-program.js";

/** The `binference` an install from the packed tarballs holds, run as an owner runs it. */
export interface PackedBinference {
  /** Runs one command to its end within the time limit: its exit code and standard output. */
  run(
    args: readonly string[],
    timeoutMs: number,
  ): Promise<{ readonly exitCode: number | undefined; readonly stdout: string }>;
  /** Starts a long-running command, such as `start --foreground`, and watches its output. */
  start(args: readonly string[], signal: AbortSignal): SourceProgram;
}

/** Where the installed command is, and what each of its processes gets. */
export interface PackedBinferenceOptions {
  /** The command's own file in the install's `node_modules/binference`. */
  readonly bin: string;
  /** This process's environment, of which a program gets only what its OS needs to run Node. */
  readonly parentEnv: Readonly<Record<string, string | undefined>>;
  /** Every other variable each process gets, such as `BINFERENCE_HOME`. */
  readonly env: Readonly<Record<string, string>>;
}

/**
 * The installed `binference`, each command a process of this Node with no loader or condition of
 * the workspace and only the variables the options name, so nothing of the repository reaches it.
 */
export function createPackedBinference(options: PackedBinferenceOptions): PackedBinference {
  const start = (args: readonly string[], signal: AbortSignal): SourceProgram => {
    const program = startNodeProgram({
      args: [options.bin, ...args],
      parentEnv: options.parentEnv,
      env: options.env,
      signal,
    });
    return { program, ...watchProgramLines(program) };
  };
  return {
    start,
    run: async (args, timeoutMs) => {
      const started = start(args, AbortSignal.timeout(timeoutMs));
      const exitCode = await started.program.exited;
      // No line holds a NUL, so this waits for the end of the output.
      await started.lineWith("\u0000");
      return { exitCode, stdout: started.lines().join("\n") };
    },
  };
}
