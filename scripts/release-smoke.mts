import process from "node:process";
import { checkPackedRelease } from "./release/packed-install.mjs";
import { readReleaseManifest } from "./release/release-plan.mjs";

// The release workflow's smoke job: the packed files a dry run wrote, checked on their own
// runner. The built-package smoke test grows from checkPackedRelease.
const [folder] = process.argv.slice(2);
if (folder === undefined) {
  console.error("Usage: pnpm release:smoke <folder>, the folder a release:dry run wrote.");
  process.exit(1);
}
const manifest = readReleaseManifest(folder);
checkPackedRelease({
  folder,
  version: manifest.version,
  packages: manifest.packages,
  root: process.cwd(),
});
console.log(`release:smoke: the packed ${manifest.version} installs and reports its version.`);
