import process from "node:process";
import {
  checkPackedInstall,
  installPackedRelease,
  type PackedRelease,
} from "./release/packed-install.mjs";
import { readPackedManifest } from "./release/release-plan.mjs";
import { runCommandShown } from "./run-command.mjs";

// The built-package smoke test (decision 0354) on the folder a release:dry run wrote: the
// tarballs install into an empty project outside the repository, every file their manifests name
// is there, `binference --version` prints the version and every package loads. Then the installed
// binference sets up with `init --yes`, starts, makes a paper trade by chat on the synthetic Bot
// API with a scripted model, and stops. The paper trade's driver runs from the repository's
// sources; the binference it drives runs only from the install.
const driver = "packages/cli/src/packed/packed-paper-trade.ts";
const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error("Usage: pnpm release:smoke <folder>, the folder a release:dry run wrote.");
  process.exit(1);
}
const started = performance.now();
const manifest = readPackedManifest(folder);
const release: PackedRelease = {
  folder,
  version: manifest.version,
  packages: manifest.packages,
  root: process.cwd(),
};
const install = installPackedRelease(release);
try {
  checkPackedInstall(release, install);
  console.log(`release:smoke: the packed ${manifest.version} installs, loads and names its files.`);
  const node = ["node", "--conditions=@binference/source", "--import", "tsx"];
  const status = runCommandShown([...node, driver, install.folder], { cwd: release.root });
  if (status !== 0) {
    console.error("release:smoke: the paper trade by chat failed; its output is above.");
    process.exitCode = 1;
  }
} catch (error) {
  console.error(`release:smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  install.remove();
}
const seconds = Math.round((performance.now() - started) / 1000);
console.log(
  `release:smoke: ${process.exitCode === 1 ? "failed" : "passed"} in ${String(seconds)} s.`,
);
