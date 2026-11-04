import process from "node:process";
import {
  checkPackedInstall,
  installPackedRelease,
  type PackedRelease,
} from "./release/packed-install.mjs";
import { readReleaseManifest } from "./release/release-plan.mjs";

// The release workflow's smoke job: the packed files a dry run wrote, checked on their own
// runner. The tarballs install into an empty project outside the repository, every file their
// manifests name is there, `binference --version` prints the version and every package loads.
const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error("Usage: pnpm release:smoke <folder>, the folder a release:dry run wrote.");
  process.exit(1);
}
const manifest = readReleaseManifest(folder);
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
} catch (error) {
  console.error(`release:smoke: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
} finally {
  install.remove();
}
