import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { parseArgs } from "node:util";
import type { ReleaseNotes } from "@binference/protocol";
import { packedReadmeFindings } from "./release/check-readmes.mjs";
import { readOwnerNotes } from "./release/owner-notes.mjs";
import { checksums, packPackage, type PackedFile } from "./release/pack-release.mjs";
import {
  checkPackedInstall,
  installPackedRelease,
  readInstallSbom,
  type PackedRelease,
} from "./release/packed-install.mjs";
import { commitsSince, dirtyTreeProblem, releasePoint } from "./release/release-git.mjs";
import { releaseNotes } from "./release/release-notes.mjs";
import {
  manifestFile,
  type NightlyManifest,
  publishedPackages,
  type ReleaseManifest,
} from "./release/release-plan.mjs";
import { nightlyVersionProblem, parseReleaseTag, type ReleaseTag } from "./release/release-tag.mjs";
import { publishProblems } from "./release/stage-package.mjs";
import { readWorkspace, type Workspace } from "./release/workspace-manifests.mjs";
import { runCommand, runCommandShown } from "./run-command.mjs";

const usage =
  "Usage: pnpm release:dry <tag> [--since <ref>]. Builds, packs and checks the release the tag " +
  "names, writes its artifacts to reports/release/<version>/, and publishes nothing. " +
  "pnpm release:dry --pack-only <YYYY.M.PATCH-nightly.N> packs a nightly build that nothing " +
  "publishes, for the built-package smoke.";

/** What the command was asked: a release's dry run from its tag, or a nightly pack. */
type DryRunAsk =
  | { readonly kind: "release"; readonly release: ReleaseTag; readonly since: string | undefined }
  | { readonly kind: "nightly"; readonly version: string };

function fail(message: string): never {
  console.error(`release:dry: ${message}`);
  process.exit(1);
}

function readArguments(): DryRunAsk {
  const { positionals, values } = parseArgs({
    allowPositionals: true,
    options: { since: { type: "string" }, "pack-only": { type: "string" } },
  });
  const nightly = values["pack-only"];
  if (nightly !== undefined) {
    const problem = positionals.length > 0 ? usage : nightlyVersionProblem(nightly);
    return problem === undefined ? { kind: "nightly", version: nightly } : fail(problem);
  }
  const [tag] = positionals;
  if (tag === undefined || positionals.length > 1) {
    return fail(usage);
  }
  const release = parseReleaseTag(tag);
  return typeof release === "string"
    ? fail(release)
    : { kind: "release", release, since: values.since };
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

// Builds and packs the published packages at the version into reports/release/<version>/, checks
// each packed README with the style guard and writes SHA256SUMS.
function packAll(
  root: string,
  pack: {
    readonly version: string;
    readonly isNightly: boolean;
    readonly releaseNotes?: ReleaseNotes;
  },
): { readonly out: string; readonly files: readonly PackedFile[] } {
  const published = publishedPackages(root);
  const workspace = readyWorkspace(root, published);
  build(root, published);
  const out = join(root, "reports", "release", pack.version);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const files = published.map((name) => packPackage({ workspace, ...pack }, name, out));
  const readmeFindings = packedReadmeFindings(root, out, files);
  if (readmeFindings.length > 0) {
    return fail(`a packed README breaks the style guard:\n${readmeFindings.join("\n")}`);
  }
  writeFileSync(join(out, "SHA256SUMS"), checksums(files));
  return { out, files };
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

// Installs the packed files into an empty project and checks them there; with `sbom`, writes the
// install's SBOM beside them under that name. The built-package smoke goes on to trade on paper
// there (pnpm release:smoke).
function checkInstall(packed: PackedRelease, sbom?: string): void {
  const install = installPackedRelease(packed);
  try {
    checkPackedInstall(packed, install);
    if (sbom !== undefined) {
      writeFileSync(join(packed.folder, sbom), readInstallSbom(install).trim() + "\n");
    }
  } finally {
    install.remove();
  }
}

function kib(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KiB`;
}

function listFiles(out: string, files: readonly PackedFile[]): void {
  console.log(`Artifacts in ${out}:`);
  for (const packed of files) {
    console.log(`  ${packed.file}  ${kib(packed.bytes)}  sha256 ${packed.sha256}`);
  }
}

function report(out: string, manifest: ReleaseManifest, files: readonly PackedFile[]): void {
  console.log(
    `\nrelease:dry: ${manifest.tag} on the ${manifest.channel} channel, nothing published.`,
  );
  listFiles(out, files);
  console.log(`  SHA256SUMS, ${manifest.sbom}, ${manifest.notes}, ${manifestFile}`);
  console.log(`npm: each package at ${manifest.version}, dist-tag ${manifest.npmTag}.`);
  console.log(
    `Image: binference:${manifest.imageTags.join(", binference:")} (linux/amd64, linux/arm64).`,
  );
}

function packedOf(files: readonly PackedFile[]): ReleaseManifest["packages"] {
  return files.map(({ name, file, bytes, sha256 }) => ({ name, file, bytes, sha256 }));
}

function dryRunRelease(root: string, ask: Extract<DryRunAsk, { kind: "release" }>): void {
  const { release } = ask;
  const point = releasePoint(root, release);
  if (typeof point === "string") {
    return fail(point);
  }
  console.log(
    point.tagged
      ? `release:dry: ${release.tag} names HEAD ${point.commit}.`
      : `release:dry: ${release.tag} does not exist yet; the dry run cuts it from HEAD ${point.commit}.`,
  );
  const ownerNotes = readOwnerNotes(root, release.version);
  if (!ownerNotes.ok) {
    return fail(`the release's notes for owners are not ready:\n${ownerNotes.problems.join("\n")}`);
  }
  const { out, files } = packAll(root, {
    version: release.version,
    isNightly: false,
    releaseNotes: ownerNotes.notes,
  });
  const start = ask.since ?? point.previous;
  const notes = releaseNotes({ release, since: start, commits: commitsSince(root, start) });
  writeFileSync(join(out, "notes.md"), notes);
  const sbom = `binference-${release.version}.cdx.json`;
  checkInstall({ folder: out, version: release.version, packages: files, root }, sbom);
  publishDryRun(out, release, files);
  const manifest: ReleaseManifest = {
    tag: release.tag,
    version: release.version,
    channel: release.channel,
    npmTag: release.npmTag,
    imageTags: release.imageTags,
    packages: packedOf(files),
    sbom,
    notes: "notes.md",
  };
  writeFileSync(join(out, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  report(out, manifest, files);
}

// A nightly pack (decision 0354): no tag, channel or version order to check and no notes; every
// published manifest is private and the manifest's channel is `nightly`, so nothing publishes it.
function packNightly(root: string, version: string): void {
  const dirty = dirtyTreeProblem(root);
  if (dirty !== undefined) {
    return fail(dirty);
  }
  const { out, files } = packAll(root, { version, isNightly: true });
  checkInstall({ folder: out, version, packages: files, root });
  const manifest: NightlyManifest = { version, channel: "nightly", packages: packedOf(files) };
  writeFileSync(join(out, manifestFile), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\nrelease:dry: the nightly ${version}, packed for the smoke; nothing publishes it.`);
  listFiles(out, files);
}

const root = process.cwd();
const ask = readArguments();
switch (ask.kind) {
  case "release":
    dryRunRelease(root, ask);
    break;
  case "nightly":
    packNightly(root, ask.version);
    break;
}
