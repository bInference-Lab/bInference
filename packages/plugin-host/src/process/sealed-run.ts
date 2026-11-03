/** What the plugin program reads of how it was started. */
export interface ProgramStart {
  /** `process.permission`: absent outside the permission model. */
  readonly permission: { has(scope: string): boolean } | undefined;
  readonly execArgv: readonly string[];
  /** The `NODE_OPTIONS` variable, which the host never sets. */
  readonly nodeOptions: string | undefined;
}

// The flags `pluginNodeArguments` passes, and no other: one more, such as
// `--allow-natives-syntax` or `--expose-internals`, would widen what the plugin's code may do.
const allowedFlags = [
  /^--permission$/,
  /^--allow-fs-read=.+$/,
  /^--allow-fs-write=.+$/,
  /^--no-experimental-sqlite$/,
  /^--no-addons$/,
  /^--disable-sigusr1$/,
  /^--disallow-code-generation-from-strings$/,
  /^--max-old-space-size=\d+$/,
] as const;
const requiredFlags = [
  "--permission",
  "--no-experimental-sqlite",
  "--no-addons",
  "--disable-sigusr1",
  "--disallow-code-generation-from-strings",
] as const;
// Grants a plugin never holds: the whole file system, the network, processes, workers, the
// inspector, WASI, addons and FFI.
const refusedScopes = [
  "fs.read",
  "fs.write",
  "net",
  "child",
  "worker",
  "inspector",
  "wasi",
  "addon",
  "ffi",
] as const;

/**
 * Whether the plugin program runs sealed (decision 0343): under the permission model with no
 * grant beyond its own folders, with exactly the flags `pluginNodeArguments` passes, and with no
 * `NODE_OPTIONS`. A plugin never runs otherwise.
 */
export function isSealedRun(start: ProgramStart): boolean {
  const { permission, execArgv, nodeOptions } = start;
  return (
    permission !== undefined &&
    refusedScopes.every((scope) => !permission.has(scope)) &&
    execArgv.every((flag) => allowedFlags.some((allowed) => allowed.test(flag))) &&
    requiredFlags.every((flag) => execArgv.includes(flag)) &&
    (nodeOptions === undefined || nodeOptions === "")
  );
}
