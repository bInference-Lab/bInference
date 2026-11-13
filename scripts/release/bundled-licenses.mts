import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, posix, relative, sep } from "node:path";
import { z } from "zod";
import {
  allowedLicensesPath,
  type BundledPackage,
  bundledLicensesFile,
  bundledLicensesText,
  keptLicenseFile,
  keptLicensesFolder,
  licenseFileKind,
  licenseProblems,
  type NamedText,
  parseAllowedLicenses,
} from "../../packages/cli/src/packed/bundled-licenses.js";
import {
  type BundleRecord,
  bundledFolders,
  bundleRecordSchema,
  type PackedCopy,
} from "../../packages/cli/src/packed/bundled-packages.js";
import { runtimeClosure, type Workspace } from "./workspace-manifests.mjs";

const recordFolder = "bundle-record";

const manifestSchema = z.looseObject({
  name: z.string(),
  version: z.string(),
  license: z.union([z.string(), z.looseObject({ type: z.string() })]).optional(),
});

function slashed(path: string): string {
  return path.split(sep).join("/");
}

function filesUnder(folder: string): readonly string[] {
  if (!existsSync(folder)) {
    return [];
  }
  return readdirSync(folder, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => slashed(relative(folder, join(entry.parentPath, entry.name))));
}

function recordsOf(folder: string): Readonly<Record<string, BundleRecord>> {
  const records = filesUnder(join(folder, recordFolder)).filter((file) => file.endsWith(".json"));
  return Object.fromEntries(
    records.map((file): [string, BundleRecord] => [
      posix.join(recordFolder, file),
      bundleRecordSchema.parse(JSON.parse(readFileSync(join(folder, recordFolder, file), "utf8"))),
    ]),
  );
}

// A copy's files as the tarball holds them; the published package's own copy leaves out the
// workspace packages staged inside its node_modules, which are copies of their own.
function copyOf(workspace: Workspace, name: string, staged: string): PackedCopy {
  const entry = workspace.packages.get(name);
  if (entry === undefined) {
    throw new Error(`${name} is not a workspace package.`);
  }
  const files = filesUnder(staged).filter((file) => !file.startsWith("node_modules/"));
  return { folder: entry.folder, files, records: recordsOf(join(workspace.root, entry.folder)) };
}

function textsOf(folder: string, kind: "license" | "notice"): readonly NamedText[] {
  return readdirSync(folder, { withFileTypes: true })
    .filter((entry) => entry.isFile() && licenseFileKind(entry.name) === kind)
    .map((entry) => ({ file: entry.name, text: readFileSync(join(folder, entry.name), "utf8") }))
    .toSorted((a, b) => a.file.localeCompare(b.file));
}

// The license the repository keeps for a package whose npm tarball ships none.
function keptLicense(root: string, name: string, version: string): readonly NamedText[] {
  const kept = join(root, keptLicensesFolder, keptLicenseFile(name, version));
  return existsSync(kept)
    ? [{ file: "LICENSE, from its repository", text: readFileSync(kept, "utf8") }]
    : [];
}

function bundledPackageAt(root: string, folder: string): BundledPackage {
  const at = join(root, folder);
  const manifest = manifestSchema.parse(JSON.parse(readFileSync(join(at, "package.json"), "utf8")));
  const { name, version, license } = manifest;
  const shipped = textsOf(at, "license");
  return {
    name,
    version,
    license: typeof license === "object" ? license.type : license,
    licenseFiles: shipped.length > 0 ? shipped : keptLicense(root, name, version),
    noticeFiles: textsOf(at, "notice"),
  };
}

/**
 * Writes `BUNDLED-LICENSES.md` into a published package staged in `staged`, with every outside
 * package whose code its files or the workspace packages inside it carry, as their builds'
 * records name them, each with its license and notice files in full. Returns whether it wrote
 * the file: a tarball with no outside code needs none. Throws, naming the tarball and each
 * package, when a file is in no record, or a bundled package names no license, one the allowed
 * list does not allow, or ships no license text.
 */
export function writeBundledLicenses(workspace: Workspace, name: string, staged: string): boolean {
  const { root } = workspace;
  const copies = [
    copyOf(workspace, name, staged),
    ...runtimeClosure(workspace, name).map((inside) =>
      copyOf(workspace, inside, join(staged, "node_modules", inside)),
    ),
  ];
  const { folders, problems } = bundledFolders(copies);
  const packages = folders.map((folder) => bundledPackageAt(root, folder));
  const allowed = parseAllowedLicenses(readFileSync(join(root, allowedLicensesPath), "utf8"));
  const refused = [...problems, ...licenseProblems(name, packages, allowed)];
  if (refused.length > 0) {
    throw new Error(`${name} cannot ship the outside code it bundles:\n${refused.join("\n")}`);
  }
  if (packages.length === 0) {
    return false;
  }
  writeFileSync(join(staged, bundledLicensesFile), bundledLicensesText(name, packages));
  return true;
}
