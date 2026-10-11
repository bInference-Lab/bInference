/**
 * The arguments to start the runtime with (runtime spec, section 2.1): Node's permission model,
 * which lets it read only the program it runs and grants it the network alone, for the engine's
 * IPC socket and the model providers; code from strings off; then the built entry,
 * `runtime-process.mjs`, by its real path with no link on the way. It may start no child process
 * or worker and write no file. The engine starts `process.execPath` with these arguments, an empty
 * environment and pipes for standard input and output.
 */
export function runtimeNodeArguments(entry: string): readonly string[] {
  return ["--permission", "--allow-net", "--disallow-code-generation-from-strings", entry];
}
