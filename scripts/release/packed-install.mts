import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { runCommand } from "../run-command.mjs";

/** The packed tarballs to install, where they sit, and the version they must report. */
export interface PackedRelease {
  /** The folder that holds the tarballs; the check works in its `smoke` folder. */
  readonly folder: string;
  readonly version: string;
  readonly packages: readonly { readonly name: string; readonly file: string }[];
  /** The repository's root, for its `.npmrc`. */
  readonly root: string;
}

const binSchema = z.looseObject({ bin: z.record(z.string(), z.string()) });

function run(command: readonly string[], cwd: string, env: Record<string, string> = {}): string {
  const result = runCommand(command, { cwd, env });
  if (result.status !== 0) {
    throw new Error(`${command.join(" ")} failed in ${cwd}:\n${result.output}`);
  }
  return result.output;
}

// An empty project that installs only the packed files, with the repository's npm settings: the
// workspace packages come from the tarballs alone, outside ones from the registry.
function installTarballs(release: PackedRelease, smoke: string): void {
  rmSync(smoke, { recursive: true, force: true });
  mkdirSync(smoke, { recursive: true });
  const project = { name: "binference-release-check", version: release.version, private: true };
  writeFileSync(join(smoke, "package.json"), `${JSON.stringify(project, null, 2)}\n`);
  cpSync(join(release.root, ".npmrc"), join(smoke, ".npmrc"));
  const tarballs = release.packages.map((item) => resolve(release.folder, item.file));
  run(
    [
      "npm",
      "install",
      "--no-audit",
      "--no-fund",
      "--ignore-scripts",
      "--loglevel=error",
      ...tarballs,
    ],
    smoke,
  );
}

// The command's own file run with this Node, as npm's link would run it.
function checkVersion(release: PackedRelease, smoke: string): void {
  const folder = join(smoke, "node_modules", "binference");
  const manifest = binSchema.parse(JSON.parse(readFileSync(join(folder, "package.json"), "utf8")));
  const bin = manifest.bin["binference"];
  if (bin === undefined) {
    throw new Error("The packed binference package names no binference command.");
  }
  const home = join(smoke, "home");
  mkdirSync(home, { recursive: true });
  const output = run(["node", join(folder, bin), "--version"], smoke, { BINFERENCE_HOME: home });
  if (!output.includes(release.version)) {
    throw new Error(`binference --version printed ${output.trim()}, not ${release.version}.`);
  }
}

/**
 * The quick check of the packed release: the tarballs install into an empty project with
 * install scripts off, `binference --version` prints the release's version, and every package
 * loads. The built-package smoke test extends this check. Returns the CycloneDX SBOM of what was
 * installed.
 */
export function checkPackedRelease(release: PackedRelease): string {
  const smoke = join(release.folder, "smoke");
  installTarballs(release, smoke);
  checkVersion(release, smoke);
  for (const item of release.packages) {
    run(
      ["node", "--input-type=module", "--eval", `await import(${JSON.stringify(item.name)});`],
      smoke,
    );
  }
  return run(
    ["npm", "sbom", "--sbom-format", "cyclonedx", "--omit", "dev", "--loglevel=error"],
    smoke,
  );
}
