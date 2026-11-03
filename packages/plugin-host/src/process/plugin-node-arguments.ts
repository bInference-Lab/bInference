/** A community plugin's two folders, each an absolute path with no link on the way. */
export interface PluginFolders {
  /** Its installed files, which it may read and never write. */
  readonly packageFolder: string;
  /** The one folder it may write, and its working folder. */
  readonly dataFolder: string;
}

/** What a starter needs to start one plugin: its id and its folders. */
export interface PluginLaunch {
  readonly id: string;
  readonly folders: PluginFolders;
}

/** The heap a plugin's process may hold, in MiB (decision 0300). */
const pluginHeapMiB = 256;

/**
 * The arguments to start a community plugin's process with (decision 0300, decision 0343):
 * Node's permission model with a read grant for its package and data folders and a write grant
 * for its data folder alone, and no other grant, so Node refuses it the network, child processes,
 * workers, native addons, WASI, FFI and the inspector; `node:sqlite` off, since it ignores the
 * file grants; native addons off; its debugger's signal off; code from strings off; a heap of 256
 * MiB; then the plugin program, `plugin-process.mjs`, by its real path. The host starts
 * `process.execPath` with these, in the data folder, with pipes for standard input and output and
 * an environment of only what the OS needs to run Node.
 */
export function pluginNodeArguments(program: string, folders: PluginFolders): readonly string[] {
  return [
    "--permission",
    `--allow-fs-read=${folders.packageFolder}`,
    `--allow-fs-read=${folders.dataFolder}`,
    `--allow-fs-write=${folders.dataFolder}`,
    "--no-experimental-sqlite",
    "--no-addons",
    "--disable-sigusr1",
    "--disallow-code-generation-from-strings",
    `--max-old-space-size=${String(pluginHeapMiB)}`,
    program,
  ];
}
