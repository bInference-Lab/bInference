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

const posixMagic = "ustar\u000000";
const gnuMagic = "ustar  \u0000";
const checksumAt = 148;
const checksumLength = 8;
const space = 0x20;

const isZero = (bytes: Uint8Array): boolean => bytes.every((byte) => byte === 0);

// The header's checksum: the sum of its bytes, its own field counted as spaces.
function checksumHolds(header: Uint8Array): boolean {
  const stored = octal(header, checksumAt, checksumLength);
  const sum = header.reduce(
    (total, byte, index) =>
      total + (index >= checksumAt && index < checksumAt + checksumLength ? space : byte),
    0,
  );
  return stored === sum;
}

/** A header read: an entry, the end of the archive, or a header no tar writer makes. */
type HeaderRead =
  | { readonly kind: "entry"; readonly header: Header }
  | { readonly kind: "end" }
  | { readonly kind: "broken" };

// A ustar header, POSIX or GNU, whose checksum holds: the name, joined to its prefix when the
// header is POSIX's (a GNU header keeps other fields there), its size in octal and its type flag.
// An empty block ends the archive.
function headerAt(bytes: Uint8Array, at: number): HeaderRead {
  const header = bytes.subarray(at, at + block);
  if (isZero(header)) {
    return { kind: "end" };
  }
  const magic = decoder.decode(header.subarray(257, 265));
  const name = field(header, 0, 100);
  const size = octal(header, 124, 12);
  const known = magic === posixMagic || magic === gnuMagic;
  if (!known || !checksumHolds(header) || name === "" || Number.isNaN(size)) {
    return { kind: "broken" };
  }
  const prefix = magic === posixMagic ? field(header, 345, 155) : "";
  const type = field(header, 156, 1);
  return {
    kind: "entry",
    header: { name: prefix === "" ? name : `${prefix}/${name}`, size, type },
  };
}

/** What a pax extended header says of the next entry: its path, or that it must be refused. */
type PaxRead = { readonly path: string | undefined } | "refused";

// The records of a pax extended header ("<length> <key>=<value>\n"): its `path`, when it has
// one; a `size` or `linkpath` record, which another reader would honor, refuses the archive.
function paxOf(body: Uint8Array): PaxRead {
  const text = decoder.decode(body);
  if (/(?:^|\n)\d+ (?:size|linkpath)=/.test(text)) {
    return "refused";
  }
  return { path: /(?:^|\n)\d+ path=([^\n]*)\n/.exec(text)?.[1] };
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
  if (header.type === "x" || header.type === "g") {
    const pax = paxOf(body);
    if (pax === "refused") {
      return { kind: "refused" };
    }
    return { kind: "next", name: header.type === "x" ? pax.path : undefined };
  }
  if (header.type === "5") {
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
    const read = headerAt(tar, at);
    if (read.kind !== "entry") {
      // Nothing but zeros may follow the end: another reader could read on past it.
      return read.kind === "end" && isZero(tar.subarray(at)) ? ok(files) : err("broken");
    }
    const { header } = read;
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
 * `..`, or a header that runs past the end refuses the whole archive, and so does anything another
 * reader such as npm's could read otherwise: a header that is not ustar or whose checksum fails, a
 * pax `size` or `linkpath`, or a byte other than zero after the end. Nothing is written to disk.
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
