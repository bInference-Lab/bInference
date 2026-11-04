import { err, jsonValueSchema, ok, type Result } from "@binference/core";
import { digestOfFiles, type PluginFile, probeId } from "@binference/plugin-host";
import { type CommunityManifest, communityManifestSchema } from "@binference/plugin-sdk/community";
import { z } from "zod";
import { readTarGz } from "../skills/tar-files.js";

/** A community plugin's package read from its tarball, before anything is written. */
export interface PluginPackage {
  /** Its files, each by its path inside the package, `package/` left out. */
  readonly files: readonly PluginFile[];
  readonly manifest: CommunityManifest;
  /** The SHA-256 of its files that pins it, 64 hex digits (decision 0348). */
  readonly filesHash: string;
}

/** The most a plugin's package may hold (decision 0348), so every disk can hold its paths. */
const limits = { files: 1_000, bytes: 16 * 1024 * 1024, pathLength: 200, parts: 16 } as const;
const top = "package/";

// One part of a path: letters, digits and `. _ @ + -`, never ending in `.`, so never `.` or `..`.
const partPattern = /^[A-Za-z0-9._@+-]{0,254}[A-Za-z0-9_@+-]$/;
// A name Windows keeps for a device, whatever follows its first dot.
const deviceName = /^(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/i;

function isPlainPath(path: string): boolean {
  const parts = path.split("/");
  const fits = path.length <= limits.pathLength && parts.length <= limits.parts;
  return fits && parts.every((part) => partPattern.test(part) && !deviceName.test(part));
}

// Whether a file's path is also another file's folder, which no disk can hold.
function holdsFileAsFolder(paths: ReadonlySet<string>): boolean {
  return [...paths].some((path) =>
    path
      .split("/")
      .slice(0, -1)
      .some((_part, index, parts) => paths.has(parts.slice(0, index + 1).join("/"))),
  );
}

// The package's own files, each inside `package/` with a plain path, none twice when case is
// ignored, as a disk that ignores case would hold them.
function packageFiles(files: readonly PluginFile[]): readonly PluginFile[] | undefined {
  const inside = files.map(({ path, bytes }) =>
    path.startsWith(top) ? { path: path.slice(top.length), bytes } : undefined,
  );
  const plain = inside.flatMap((file) =>
    file !== undefined && isPlainPath(file.path) ? [file] : [],
  );
  const folded = new Set(plain.map(({ path }) => path.toLowerCase()));
  const size = plain.reduce((total, { bytes }) => total + bytes.byteLength, 0);
  const fits = plain.length <= limits.files && size <= limits.bytes && !holdsFileAsFolder(folded);
  return plain.length === files.length && folded.size === plain.length && fits ? plain : undefined;
}

const packageJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  binference: communityManifestSchema,
});

function manifestOf(
  files: readonly PluginFile[],
  expected: { readonly name: string; readonly version: string },
): CommunityManifest | undefined {
  const file = files.find(({ path }) => path === "package.json");
  if (file === undefined) {
    return undefined;
  }
  try {
    const json = jsonValueSchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(file.bytes)),
    );
    const read = packageJsonSchema.safeParse(json);
    const named = read.success && read.data.name === expected.name;
    return named && read.data.version === expected.version ? read.data.binference : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads a community plugin's package from its tarball, in memory (decision 0348): only plain
 * files under `package/`, each path of letters, digits and `. _ @ + -` with no part ending in `.`
 * and no Windows device name, at most 200 characters and 16 parts, none twice when case is
 * ignored, none also another file's folder, at most 1,000 files and 16 MiB; a link, a device or a
 * path outside refuses the whole archive. Its `package.json` must name the version asked for and hold
 * a `binference` field the community manifest schema reads, whose entry is one of its files and
 * whose id is not the probe plugin's. Anything else is `invalid`. Nothing is written or run.
 */
export function readPluginPackage(
  tarball: Uint8Array,
  expected: { readonly name: string; readonly version: string },
): Result<PluginPackage, "invalid"> {
  const read = readTarGz(tarball);
  const files = read.ok ? packageFiles(read.value) : undefined;
  if (files === undefined) {
    return err("invalid");
  }
  const manifest = manifestOf(files, expected);
  const entryHeld = files.some(({ path }) => path === manifest?.entry);
  if (manifest === undefined || !entryHeld || manifest.id === probeId) {
    return err("invalid");
  }
  return ok({ files, manifest, filesHash: digestOfFiles(files) });
}
