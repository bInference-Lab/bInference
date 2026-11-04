import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runCommand } from "../run-command.mjs";
import { findMissingEntries } from "./packed-entries.mjs";

/** The packed tarballs to install, where they sit, and the version they must report. */
export interface PackedRelease {
  /** The folder that holds the tarballs. */
  readonly folder: string;
  readonly version: string;
  readonly packages: readonly { readonly name: string; readonly file: string }[];
  /** The repository's root, for its `.npmrc`. */
  readonly root: string;
}

/** The packed tarballs installed in an empty project of their own. */
export interface PackedInstall {
  /** The project's folder, outside the repository. */
  readonly folder: string;
  /** Removes the project. */
  remove(): void;
}

const binSchema = z.looseObject({ bin: z.record(z.string(), z.string()) });

function run(command: readonly string[], cwd: string, env: Record<string, string> = {}): string {
  const result = runCommand(command, { cwd, env });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed in ${cwd}:\n${result.output}`);
  }
  return result.output;
}

/**
 * Installs the packed tarballs into an empty project in the OS's temporary folder, with the
 * repository's npm settings and install scripts off: the workspace packages come from the
 * tarballs alone, outside ones from the registry. The project sits outside the repository, so
 * Node never finds a package the tarballs lack in the repository's own `node_modules`.
 */
export function installPackedRelease(release: PackedRelease): PackedInstall {
  const parent = mkdtempSync(join(tmpdir(), "binference-packed-"));
  // npm's SBOM names its root component after the project's folder, the same on every machine.
  const name = "binference-release-check";
  const folder = join(parent, name);
  const remove = (): void => {
    rmSync(parent, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  };
  try {
    mkdirSync(folder);
    const project = { name, version: release.version, private: true };
    writeFileSync(join(folder, "package.json"), `${JSON.stringify(project, null, 2)}\n`);
    cpSync(join(release.root, ".npmrc"), join(folder, ".npmrc"));
    // Copied in, so the project names each tarball by its file name.
    const tarballs = release.packages.map((item) => {
      cpSync(resolve(release.folder, item.file), join(folder, item.file));
      return `./${item.file}`;
    });
    const flags = ["--no-audit", "--no-fund", "--ignore-scripts", "--loglevel=error"];
    run(["npm", "install", ...flags, ...tarballs], folder);
  } catch (error) {
    remove();
    throw error;
  }
  return { folder, remove };
}

// The command's own file run with this Node, as npm's link would run it.
function checkVersion(release: PackedRelease, install: PackedInstall): void {
  const folder = join(install.folder, "node_modules", "binference");
  const manifest = binSchema.parse(JSON.parse(readFileSync(join(folder, "package.json"), "utf8")));
  const bin = manifest.bin["binference"];
  if (bin === undefined) {
    throw new Error("The packed binference package names no binference command.");
  }
  const home = join(install.folder, "home");
  mkdirSync(home, { recursive: true });
  const output = run(["node", join(folder, bin), "--version"], install.folder, {
    BINFERENCE_HOME: home,
  });
  if (!output.includes(release.version)) {
    throw new Error(`binference --version printed ${output.trim()}, not ${release.version}.`);
  }
}

/**
 * The quick check of an install of the packed release: every file each package's manifest names
 * is there (its exports, its command and its main), `binference --version` prints the release's
 * version, and every package loads. Throws, naming what failed.
 */
export function checkPackedInstall(release: PackedRelease, install: PackedInstall): void {
  const missing = findMissingEntries(
    install.folder,
    release.packages.map((item) => item.name),
  );
  if (missing.length > 0) {
    throw new Error(`A packed package names files it lacks:\n${missing.join("\n")}`);
  }
  checkVersion(release, install);
  for (const item of release.packages) {
    run(
      ["node", "--input-type=module", "--eval", `await import(${JSON.stringify(item.name)});`],
      install.folder,
    );
  }
}

// npm names a tarball's distribution by its absolute path on the machine that ran the install,
// which would publish that machine's folders with the release.
const tarballPath = /"file:[^"]*[\\/]([^"\\/]+\.tgz)"/g;

/**
 * npm's CycloneDX SBOM of what the install holds, without development packages, each packed
 * tarball named by its file name alone.
 */
export function readInstallSbom(install: PackedInstall): string {
  const sbom = run(
    ["npm", "sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--loglevel=error"],
    install.folder,
  );
  return sbom.replaceAll(tarballPath, '"file:$1"');
}
