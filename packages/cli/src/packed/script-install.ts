import { join } from "node:path";
import { runCommandWithin } from "@binference/platform";

const minute = 60_000;

// The macOS and Linux install script, as the owner runs it (decision 0357).
const installScript = join(import.meta.dirname, "..", "..", "..", "..", "install", "install.sh");

/** Where the install script puts binference under a home folder: its npm prefix and launcher. */
export interface ScriptInstall {
  readonly prefix: string;
  readonly launcher: string;
}

/** The install script's npm prefix and launcher under the home folder `home`. */
export function scriptInstallIn(home: string): ScriptInstall {
  const data = join(home, ".local", "share", "binference");
  return { prefix: join(data, "npm"), launcher: join(data, "bin", "binference") };
}

/**
 * Installs the packed tarball with the install script, without init, with the variables `env`
 * names on top of this process's, its home among them. Throws with the script's words when it
 * fails.
 */
export async function installByScript(
  tarball: string,
  env: Readonly<Record<string, string>>,
): Promise<void> {
  const installed = await runCommandWithin("sh", [installScript, "--skip-init"], {
    signal: AbortSignal.timeout(10 * minute),
    timeoutMs: 10 * minute,
    env: { ...env, BINFERENCE_INSTALL_PACKAGE: tarball },
  });
  if (installed.exitCode !== 0) {
    throw new Error(`the install script could not install ${tarball}:\n${installed.stderr}`);
  }
}

/**
 * Checks that the launcher prints `version` for `--version`, run with the variables `env` names:
 * the version an update left in its prefix. Throws naming what it printed.
 */
export async function expectLauncher(
  install: ScriptInstall,
  env: Readonly<Record<string, string>>,
  version: string,
): Promise<void> {
  const printed = await runCommandWithin(install.launcher, ["--version"], {
    signal: AbortSignal.timeout(minute),
    timeoutMs: minute,
    env,
  });
  if (!printed.stdout.includes(version)) {
    throw new Error(`the launcher printed ${printed.stdout.trim()}, not ${version}.`);
  }
}
