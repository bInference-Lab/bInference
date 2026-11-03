import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Logger, Result } from "@binference/core";
import {
  ensurePrivateFolder,
  type Platform,
  realFilePath,
  writePrivateFile,
} from "@binference/platform";
import {
  checkSandbox,
  createDirectStarter,
  createLauncherStarter,
  imageFolders,
  launcherVariable,
  type PluginFolders,
  type PluginStarter,
  probeId,
  type SandboxFailure,
  type SandboxPass,
  startDebugDecoy,
} from "@binference/plugin-host";
import type { CliHost } from "../program/cli-host.js";

// The check writes no log: what the probe met is the finding.
const quiet: Logger = {
  debug: () => undefined,
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
  child: () => quiet,
};

/** The plugin program and the probe plugin's folder, each by its real path. */
export interface PluginPrograms {
  /** `plugin-process.mjs`, which every community plugin runs in. */
  readonly program: string;
  /** The folder that holds the probe plugin, `sandbox-probe.mjs`, alone. */
  readonly probeFolder: string;
}

/**
 * The plugin program and probe this binference ships, by their real paths, since a plugin's
 * process may read nothing through a link; none in a run from the source files, which Node's
 * permission model cannot load.
 */
export async function builtPluginPrograms(
  signal: AbortSignal,
): Promise<PluginPrograms | undefined> {
  const program = fileURLToPath(import.meta.resolve("@binference/plugin-host/process"));
  const probe = fileURLToPath(import.meta.resolve("@binference/plugin-host/probe"));
  if (!program.endsWith(".mjs") || !probe.endsWith(".mjs")) {
    return undefined;
  }
  return {
    program: await realFilePath(program, signal),
    probeFolder: dirname(await realFilePath(probe, signal)),
  };
}

// What the probe runs under: the image's launcher when its variable names a socket, as the image
// sets, else the direct starter; its folders, and a file and folder it must not reach. Under the
// launcher the probe runs as the plugin user, so they are ones that user could reach without the
// sandbox: the engine's own program and the shared temporary folder.
interface ProbeSetting {
  readonly starter: PluginStarter;
  readonly folders: PluginFolders;
  readonly outside: { readonly file: string; readonly folder: string };
}

async function directSetting(
  run: { readonly host: CliHost; readonly platform: Platform; readonly signal: AbortSignal },
  programs: PluginPrograms,
): Promise<ProbeSetting> {
  const { host, platform, signal } = run;
  const root = join(platform.stateFolder.root, "plugins", probeId);
  const dataFolder = join(root, "data");
  const outsideFolder = join(root, "outside");
  const outsideFile = join(outsideFolder, "outside.txt");
  const files = { permissions: platform.permissions, signal };
  await ensurePrivateFolder(dataFolder, files);
  await ensurePrivateFolder(outsideFolder, files);
  await writePrivateFile(outsideFile, "The probe plugin must not read this.", files);
  return {
    starter: createDirectStarter({
      program: programs.program,
      parentEnv: host.env,
      memory: {
        read: platform.residentBytes,
        wait: async (delayMs, waitSignal) => host.clock.sleep(delayMs, waitSignal),
      },
    }),
    folders: {
      packageFolder: programs.probeFolder,
      dataFolder: await realFilePath(dataFolder, signal),
    },
    outside: { file: outsideFile, folder: outsideFolder },
  };
}

/**
 * Runs the sandbox check of decision 0300 on this machine for `binference check`: the probe
 * plugin under the image's launcher when `BINFERENCE_PLUGIN_LAUNCHER` names its socket, else
 * under the direct starter with its folders in the state folder's `plugins/sandbox-probe/`, and
 * `engineArgs` the Node options the engine runs with, as its `engine/status` says.
 */
export async function checkPluginSandbox(
  run: { readonly host: CliHost; readonly platform: Platform; readonly signal: AbortSignal },
  probe: { readonly programs: PluginPrograms; readonly engineArgs: readonly string[] },
): Promise<Result<SandboxPass, SandboxFailure>> {
  const { programs, engineArgs } = probe;
  const { host, signal } = run;
  const socket = host.env[launcherVariable];
  const setting: ProbeSetting =
    socket === undefined || socket === ""
      ? await directSetting(run, programs)
      : {
          starter: createLauncherStarter({ socket }),
          folders: imageFolders(probeId, programs.probeFolder),
          outside: { file: host.entry.script, folder: tmpdir() },
        };
  return checkSandbox(
    {
      ...setting,
      http: host.http,
      clock: host.clock,
      logger: quiet,
      engineArgs,
      startDecoy: async (decoySignal) =>
        startDebugDecoy({ parentEnv: host.env, signal: decoySignal }),
    },
    signal,
  );
}
