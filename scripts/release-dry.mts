import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import { packedReadmeFindings } from "./release/check-readmes.mjs";
import { checksums, packPackage, type PackedFile } from "./release/pack-release.mjs";
import {
  checkPackedInstall,
  installPackedRelease,
  readInstallSbom,
  type PackedRelease,
} from "./release/packed-install.mjs";
import { commitsSince, releasePoint } from "./release/release-git.mjs";
import { releaseNotes } from "./release/release-notes.mjs";
import { manifestFile, publishedPackages, type ReleaseManifest } from "./release/release-plan.mjs";
import { parseReleaseTag, type ReleaseTag } from "./release/release-tag.mjs";
import { publishProblems } from "./release/stage-package.mjs";
import { readWorkspace, type Workspace } from "./release/workspace-manifests.mjs";
import { runCommand, runCommandShown } from "./run-command.mjs";

const usage =
  "Usage: pnpm release:dry <tag> [--since <ref>]. Builds, packs and checks the release the tag " +
  "names, writes its artifacts to reports/release/<version>/, and publishes nothing.";

function fail(message: string): never {
  console.error(`release:dry: ${message}`);
  process.exit(1);
}

function readArguments(): { readonly release: ReleaseTag; readonly since: string | undefined } {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { since: { type: "string" } },
  });
  const [tag] = positionals;
  if (tag === undefined || positionals.length > 1) {
    return fail(usage);
  }
  const release = parseReleaseTag(tag);
  return typeof release === "string" ? fail(release) : { release, since: values.since };
}

function build(root: string, published: readonly string[]): void {
  const filters = published.flatMap((name) => ["--filter", `${name}...`]);
  const status = runCommandShown(
    ["pnpm", "turbo", "run", "build", ...filters, "--output-logs=errors-only"],
    { cwd: root },
  );
  if (status !== 0) {
    fail("the build failed; its errors are above.");
  }
}

function readyWorkspace(root: string, published: readonly string[]): Workspace {
  const workspace = readWorkspace(root);
  const problems = published.flatMap((name) => {
    const entry = workspace.packages.get(name);
    return entry === undefined ? [`${name} is not a workspace package.`] : publishProblems(entry);
  });
  return problems.length === 0 ? workspace : fail(problems.join("\n"));
}

// npm's own dry run of each publish, with the dist-tag the channel publishes to.
function publishDryRun(out: string, release: ReleaseTag, files: readonly PackedFile[]): void {
  for (const packed of files) {
    const result = runCommand(
      ["npm", "publish", packed.file, "--dry-run", "--tag", release.npmTag, "--loglevel=error"],
      { cwd: out },
    );
    if (result.status !== 0) {
      fail(`npm publish --dry-run refused ${packed.file}:\n${result.output}`);
    }
  }
}

// Installs the packed files into an empty project, checks them there, writes the install's SBOM
// beside them and answers its file name; the built-package smoke goes on to trade on paper there
// (pnpm release:smoke).
function writeCheckedSbom(packed: PackedRelease): string {
  const install = installPackedRelease(packed);
  try {
    checkPackedInstall(packed, install);
    const sbomFile = `binference-${packed.version}.cdx.json`;
    writeFileSync(join(packed.folder, sbomFile), readInstallSbom(install).trim() + "\n");
    return sbomFile;
  } finally {
    install.remove();
  }
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function report(out: string, manifest: ReleaseManifest, files: readonly PackedFile[]): void {
  console.log(
    `\nrelease:dry: ${manifest.tag} on the ${manifest.channel} channel, nothing published.`,
  );
  console.log(`Artifacts in ${out}:`);
  for (const packed of files) {
    console.log(`  ${packed.file}  ${kib(packed.bytes)}  sha256 ${packed.sha256}`);
  }
  console.log(`  SHA256SUMS, ${manifest.sbom}, ${manifest.notes}, ${manifestFile}`);
  console.log(`npm: each package at ${manifest.version}, dist-tag ${manifest.npmTag}.`);
  console.log(
    `Image: binference:${manifest.imageTags.join(", binference:")} (linux/amd64, linux/arm64).`,
  );
}

function main(): void {
  const root = process.cwd();
  const { release, since } = readArguments();
  const point = releasePoint(root, release);
  if (typeof point === "string") {
    return fail(point);
  }
  console.log(
    point.tagged
      ? `release:dry: ${release.tag} names HEAD ${point.commit}.`
      : `release:dry: ${release.tag} does not exist yet; the dry run cuts it from HEAD ${point.commit}.`,
  );
  const published = publishedPackages(root);
  const workspace = readyWorkspace(root, published);
  build(root, published);
  const out = join(root, "reports", "release", release.version);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = published.map((name) =>
    packPackage({ workspace, version: release.version }, name, out),
  );
  const readmeFindings = packedReadmeFindings(root, out, files);
  if (readmeFindings.length > 0) {
    return fail(`a packed README breaks the style guard:\n${readmeFindings.join("\n")}`);
  }
  writeFileSync(join(out, "SHA256SUMS"), checksums(files));
  const start = since ?? point.previous;
  const notes = releaseNotes({ release, since: start, commits: commitsSince(root, start) });
  writeFileSync(join(out, "notes.md"), notes);
  const sbomFile = writeCheckedSbom({
    folder: out,
    version: release.version,
    packages: files,
    root,
  });
  publishDryRun(out, release, files);
  const manifest: ReleaseManifest = {
    tag: release.tag,
    version: release.version,
    channel: release.channel,
    npmTag: release.npmTag,
    imageTags: release.imageTags,
    packages: files.map(({ name, file, bytes, sha256 }) => ({ name, file, bytes, sha256 })),
    sbom: sbomFile,
    notes: "notes.md",
  };
  writeFileSync(join(out, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  report(out, manifest, files);
}

main();
