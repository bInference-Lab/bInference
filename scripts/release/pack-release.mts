import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { runCommand } from "../run-command.mjs";
import { type ReleaseBuild, stagePackage } from "./stage-package.mjs";

/** A packed tarball: its package, file name, size in bytes and SHA-256. */
export interface PackedFile {
  readonly name: string;
  readonly file: string;
  readonly bytes: number;
  readonly sha256: string;
  /** The workspace packages inside it, named in its `bundleDependencies`. */
  readonly bundled: readonly string[];
}

const packOutputSchema = z.array(
  z.looseObject({
    filename: z.string(),
    files: z.array(z.looseObject({ path: z.string() })),
    bundled: z.array(z.string()),
  }),
);

// Every tarball carries the license and the notices (vet-release section 3).
const requiredFiles = ["package.json", "LICENSE", "NOTICES.md", "README.md"];

function sha256Of(file: string): string {
  return createHash("sha256").update(readFileSync(file)).digest("hex");
}

/**
 * Stages one published package in `<out>/stage/<name>` and packs it into `out` with npm, its
 * own lifecycle scripts off. Throws when npm fails or the tarball lacks a required file.
 */
export function packPackage(build: ReleaseBuild, name: string, out: string): PackedFile {
  const staged = join(out, "stage", name);
  stagePackage(build, name, staged);
  const result = runCommand(
    ["npm", "pack", "--json", "--ignore-scripts", "--loglevel=error", "--pack-destination", out],
    { cwd: staged },
  );
  if (result.status !== 0) {
    throw new Error(`npm pack failed for ${name}:\n${result.output}`);
  }
  const [packed] = packOutputSchema.parse(JSON.parse(result.output));
  if (packed === undefined) {
    throw new Error(`npm pack wrote no tarball for ${name}.`);
  }
  const paths = new Set(packed.files.map((entry) => entry.path));
  const missing = requiredFiles.filter((file) => !paths.has(file));
  if (missing.length > 0) {
    throw new Error(`${packed.filename} lacks ${missing.join(", ")}.`);
  }
  const file = join(out, packed.filename);
  return {
    name,
    file: packed.filename,
    bytes: statSync(file).size,
    sha256: sha256Of(file),
    bundled: packed.bundled,
  };
}

/** The `SHA256SUMS` text over the tarballs, in the form `sha256sum --check` reads. */
export function checksums(files: readonly PackedFile[]): string {
  return files.map((packed) => `${packed.sha256}  ${packed.file}\n`).join("");
}
