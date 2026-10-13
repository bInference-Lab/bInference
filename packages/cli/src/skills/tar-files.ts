import { gunzipSync } from "node:zlib";
import { err, ok, type Result } from "@binference/core";

/** A file of a package, by its path inside it. */
export interface PackedFile {
  readonly path: string;
  readonly bytes: Uint8Array;
}

/** Why a tarball was not read: broken, too large, or holding a link or a path outside it. */
export type TarRefusal = "broken" | "too_large" | "unsafe_entry";

const block = 512;
// What a skill's package may unpack to: a skill is at most 2 MiB, a package a little more.
const maxUnpackedBytes = 16 * 1024 * 1024;
const decoder = new TextDecoder();

/** One header of the archive. */
interface Header {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

function field(bytes: Uint8Array, start: number, length: number): string {
  const raw = bytes.subarray(start, start + length);
  const end = raw.indexOf(0);
  return decoder.decode(end === -1 ? raw : raw.subarray(0, end));
}

function octal(bytes: Uint8Array, start: number, length: number): number {
  const text = field(bytes, start, length).trim();
  return /^[0-7]+$/.test(text) ? Number.parseInt(text, 8) : Number.NaN;
}

// A ustar header: the name, joined to its prefix, its size in octal and its type flag.
function headerAt(bytes: Uint8Array, at: number): Header | undefined {
  const name = field(bytes, at, 100);
  const prefix = field(bytes, at + 345, 155);
  const size = octal(bytes, at + 124, 12);
  if (name === "" || Number.isNaN(size)) {
    return undefined;
  }
  const type = field(bytes, at + 156, 1);
  return { name: prefix === "" ? name : `${prefix}/${name}`, size, type };
}

// The `path` record of a pax extended header ("<length> path=<value>\n"), when it has one.
function paxPath(body: Uint8Array): string | undefined {
  const text = decoder.decode(body);
  return /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text)?.[1];
}

// A path inside the package and nothing above it: no absolute path, no `.` or `..` part.
function isSafePath(path: string): boolean {
  const parts = path.split("/").filter((part) => part !== "");
  return (
    !path.startsWith("/") &&
    !path.includes("\\") &&
    parts.every((part) => part !== "." && part !== "..")
  );
}

/** What one entry gives: a file, the name of the next entry, or a refusal of the archive. */
type Taken =
  | { readonly kind: "file"; readonly file: PackedFile }
  | { readonly kind: "next"; readonly name: string | undefined }
  | { readonly kind: "refused" };

// One entry: a file, a folder (nothing to keep), or a pax header naming the next entry; any other
// kind, such as a link or a device, refuses the archive.
function take(header: Header, body: Uint8Array, named: string | undefined): Taken {
  if (header.type === "x") {
    return { kind: "next", name: paxPath(body) };
  }
  if (header.type === "g" || header.type === "5") {
    return { kind: "next", name: undefined };
  }
  const path = named ?? header.name;
  if ((header.type !== "0" && header.type !== "") || !isSafePath(path)) {
    return { kind: "refused" };
  }
  const clean = path
    .split("/")
    .filter((part) => part !== "")
    .join("/");
  return { kind: "file", file: { path: clean, bytes: body } };
}

function walkArchive(tar: Uint8Array): Result<readonly PackedFile[], TarRefusal> {
  const files: PackedFile[] = [];
  let named: string | undefined;
  let at = 0;
  while (at + block <= tar.length) {
    const header = headerAt(tar, at);
    if (header === undefined) {
      return ok(files);
    }
    const end = at + block + header.size;
    if (end > tar.length) {
      return err("broken");
    }
    const taken = take(header, tar.subarray(at + block, end), named);
    if (taken.kind === "refused") {
      return err("unsafe_entry");
    }
    named = taken.kind === "next" ? taken.name : undefined;
    if (taken.kind === "file") {
      files.push(taken.file);
    }
    at += block + Math.ceil(header.size / block) * block;
  }
  return err("broken");
}

/**
 * Reads a gzipped tarball, such as an npm package, in memory: every plain file with its path and
 * bytes, the folders left implicit. A link, a device, a path that is absolute or climbs out with
 * `..`, or a header that runs past the end refuses the whole archive; nothing is written to disk.
 * It unpacks at most 16 MiB.
 */
export function readTarGz(gzipped: Uint8Array): Result<readonly PackedFile[], TarRefusal> {
  try {
    return walkArchive(gunzipSync(gzipped, { maxOutputLength: maxUnpackedBytes }));
  } catch (error) {
    // zlib stops at the output limit with a RangeError, `ERR_BUFFER_TOO_LARGE`.
    return err(error instanceof RangeError ? "too_large" : "broken");
  }
}
