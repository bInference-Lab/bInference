import { posix } from "node:path";
import { z } from "zod";

/**
 * One build's record, as the build's bundler plugin writes it in the package's `bundle-record/`
 * folder: each file the build wrote, by its path from the package's folder, with the paths of the
 * outside modules and copied files inside it.
 */
export interface BundleRecord {
  readonly files: Readonly<Record<string, readonly string[]>>;
}

/** The schema of a build's record file. */
export const bundleRecordSchema: z.ZodType<BundleRecord> = z.object({
  files: z.record(z.string(), z.array(z.string())),
});

/** A workspace package as one tarball carries it, with the records its builds wrote. */
export interface PackedCopy {
  /** Its folder from the repository's root, such as `packages/runtime`. */
  readonly folder: string;
  /** Each file the tarball holds of it, by its path from that folder. */
  readonly files: readonly string[];
  /** Each record of its builds, by the record's path from that folder. */
  readonly records: Readonly<Record<string, BundleRecord>>;
}

/** The outside packages inside one tarball's files, or why the records cannot tell. */
export interface BundledFolders {
  /** Each package's folder from the repository's root, once, in order. */
  readonly folders: readonly string[];
  /** One line per file no record names, or more than one record names. */
  readonly problems: readonly string[];
}

const nodeModules = "node_modules/";

// The files a bundler writes code into, declarations and stylesheets included. A compressed copy,
// a picture or a text file needs no record, though a font a record names still counts.
const codeFile = /\.(?:[cm]?[jt]sx?|css|html|wasm)$/;

/**
 * The folder of the package a module or copied file belongs to: the part of its path up to the
 * package's name after the last `node_modules/`, a scope taking one more part. `undefined` for a
 * path in no `node_modules` folder.
 */
export function outsidePackageFolder(path: string): string | undefined {
  const slashed = path.replaceAll("\\", "/");
  const at = slashed.lastIndexOf(nodeModules);
  if (at === -1) {
    return undefined;
  }
  const parts = slashed.slice(at + nodeModules.length).split("/");
  const [first, second] = parts;
  const name = first?.startsWith("@") === true ? [first, second] : [first];
  if (name.some((part) => part === undefined || part === "")) {
    return undefined;
  }
  return slashed.slice(0, at + nodeModules.length) + name.join("/");
}

function claimsOf(copy: PackedCopy, file: string): readonly string[] {
  return Object.entries(copy.records)
    .filter(([, record]) => Object.hasOwn(record.files, file))
    .map(([path]) => path);
}

function claimProblems(copy: PackedCopy): readonly string[] {
  return copy.files
    .filter((file) => codeFile.test(file))
    .flatMap((file) => {
      const claims = claimsOf(copy, file);
      const where = `${copy.folder}/${file}`;
      if (claims.length === 0) {
        return [`${where} is in no bundle record: build ${copy.folder} again.`];
      }
      return claims.length === 1
        ? []
        : [
            `${where} is in ${claims.join(" and ")}: remove ${copy.folder}/bundle-record and build ` +
              "again.",
          ];
    });
}

function foldersOf(copy: PackedCopy): readonly string[] {
  const shipped = new Set(copy.files);
  return Object.values(copy.records).flatMap((record) =>
    Object.entries(record.files)
      .filter(([file]) => shipped.has(file))
      .flatMap(([, sources]) => sources)
      .flatMap((source) => {
        const folder = outsidePackageFolder(posix.join(copy.folder, source.replaceAll("\\", "/")));
        return folder === undefined ? [] : [folder];
      }),
  );
}

/**
 * The outside packages a tarball carries copies of inside its files, read from the records of
 * the builds that wrote them. Every file of code the tarball holds must be in exactly one record
 * of its package; a file no build recorded, such as one built before the record existed, could
 * hold anything, so it is a problem, never a file with nothing inside.
 */
export function bundledFolders(copies: readonly PackedCopy[]): BundledFolders {
  const folders = new Set(copies.flatMap(foldersOf));
  return {
    folders: [...folders].toSorted((a, b) => a.localeCompare(b)),
    problems: copies.flatMap(claimProblems),
  };
}
