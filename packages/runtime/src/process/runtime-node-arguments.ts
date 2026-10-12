import { dirname, join } from "node:path";

/** The files the runtime opens beside its own program: `agent.sqlite`. */
export interface RuntimeFiles {
  readonly agentDb: string;
}

// SQLite keeps a database in its file and, while it writes, beside it.
const databaseSuffixes = ["", "-wal", "-shm", "-journal"] as const;

/**
 * The arguments to start the runtime with (runtime spec, section 2.1; decision 0174): Node's
 * permission model, which lets it read the program it runs and the store worker bundled beside it,
 * read and write `agent.sqlite` and SQLite's files beside it, each path named alone, start the
 * store's worker threads, and use the network alone, for the engine's IPC socket and the model
 * providers; code from strings off; then the built entry, `runtime-process.mjs`, by its real path
 * with no link on the way. It may start no child process. The engine starts `process.execPath`
 * with these arguments, an empty environment and pipes for standard input and output.
 */
export function runtimeNodeArguments(entry: string, files: RuntimeFiles): readonly string[] {
  const database = databaseSuffixes.map((suffix) => `${files.agentDb}${suffix}`);
  return [
    "--permission",
    "--allow-net",
    "--allow-worker",
    `--allow-fs-read=${join(dirname(entry), "agent.worker.mjs")}`,
    ...database.map((file) => `--allow-fs-read=${file}`),
    ...database.map((file) => `--allow-fs-write=${file}`),
    "--disallow-code-generation-from-strings",
    entry,
  ];
}
