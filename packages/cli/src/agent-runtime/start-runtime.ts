import { fileURLToPath } from "node:url";
import { type NodeProgram, realFilePath, startNodeProgram } from "@binference/platform";
import { type RuntimeFiles, runtimeNodeArguments } from "@binference/runtime";
import type { CliHost } from "../program/cli-host.js";

/** Starts one runtime process, held by its pipes; it ends at once when the signal aborts. */
export type StartRuntime = (signal: AbortSignal) => Promise<NodeProgram>;

// A checkout that runs binference from its TypeScript source runs the runtime the same way, with
// the engine's own loader options; the permission model would refuse the loader the files it
// reads, so only the built runtime runs under it.
function argumentsFor(
  entry: string,
  context: { readonly host: Pick<CliHost, "workerExecArgv">; readonly files: RuntimeFiles },
): readonly string[] {
  return entry.endsWith(".ts")
    ? [...(context.host.workerExecArgv ?? []), entry]
    : runtimeNodeArguments(entry, context.files);
}

/**
 * Starts the runtime this binference ships, `@binference/runtime/process`, by its real path (Node
 * lets a program under the permission model read only the file it was started with, never through
 * a link such as pnpm's `node_modules`): `process.execPath` with `runtimeNodeArguments`, granted
 * the agent database's files, pipes for its standard input and output, and no variable of the
 * engine's environment but what the OS needs to run Node.
 */
export function builtRuntime(
  host: Pick<CliHost, "env" | "workerExecArgv">,
  files: RuntimeFiles,
): StartRuntime {
  return async (signal) => {
    const linked = fileURLToPath(import.meta.resolve("@binference/runtime/process"));
    const entry = await realFilePath(linked, signal);
    const args = argumentsFor(entry, { host, files });
    return startNodeProgram({ args, parentEnv: host.env, signal });
  };
}
