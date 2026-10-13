import { gzipSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { readTarGz } from "./tar-files.js";

const encoder = new TextEncoder();

interface Entry {
  readonly name: string;
  readonly text?: string;
  readonly type?: string;
  readonly prefix?: string;
}

function put(header: Uint8Array, at: number, text: string): void {
  header.set(encoder.encode(text), at);
}

// One ustar entry: its header, then its body padded to whole blocks.
function entry({ name, text = "", type = "0", prefix = "" }: Entry): Uint8Array {
  const body = encoder.encode(text);
  const header = new Uint8Array(512);
  put(header, 0, name);
  put(header, 100, "0000644\0");
  put(header, 124, `${body.length.toString(8).padStart(11, "0")}\0`);
  put(header, 156, type);
  put(header, 257, "ustar\u000000");
  put(header, 345, prefix);
  const padded = new Uint8Array(Math.ceil(body.length / 512) * 512);
  padded.set(body);
  return new Uint8Array(Buffer.concat([header, padded]));
}

function tarball(entries: readonly Entry[]): Uint8Array {
  return gzipSync(Buffer.concat([...entries.map(entry), new Uint8Array(1024)]));
}

// The files of a read archive as paths and texts; a refused archive throws.
function texts(read: ReturnType<typeof readTarGz>) {
  if (!read.ok) {
    throw new Error(`The archive was refused: ${read.error}.`);
  }
  return read.value.map(({ path, bytes }) => [path, new TextDecoder().decode(bytes)]);
}

describe("readTarGz", () => {
  it("reads each plain file with its path and leaves folders implicit", () => {
    const read = readTarGz(
      tarball([
        { name: "package/", type: "5" },
        { name: "package/SKILL.md", text: "# Skill" },
        { name: "package/references/fees.md", text: "Fees." },
        { name: "fees.md", prefix: "package/docs", text: "Long path." },
      ]),
    );
    expect(texts(read)).toStrictEqual([
      ["package/SKILL.md", "# Skill"],
      ["package/references/fees.md", "Fees."],
      ["package/docs/fees.md", "Long path."],
    ]);
  });

  it("takes a long name from the pax header before its entry", () => {
    const long = `package/${"deep/".repeat(30)}SKILL.md`;
    const record = ` path=${long}\n`;
    const pax = `${String(record.length + String(record.length + 3).length)}${record}`;
    const read = readTarGz(
      tarball([
        { name: "PaxHeader", type: "x", text: pax },
        { name: "package/short-name", text: "Deep." },
      ]),
    );
    expect(texts(read)).toStrictEqual([[long, "Deep."]]);
  });

  it.each([
    ["a symbolic link", { name: "package/link", type: "2" }],
    ["a hard link", { name: "package/hard", type: "1" }],
    ["a path that climbs out", { name: "package/../../etc/passwd", text: "x" }],
    ["an absolute path", { name: "/etc/passwd", text: "x" }],
    ["a device", { name: "package/dev", type: "3" }],
  ])("refuses an archive with %s", (_name, bad) => {
    expect(readTarGz(tarball([{ name: "package/SKILL.md", text: "# Skill" }, bad]))).toStrictEqual({
      ok: false,
      error: "unsafe_entry",
    });
  });

  it("refuses bytes that are no gzip, and an entry that runs past the end", () => {
    expect(readTarGz(encoder.encode("not a tarball"))).toStrictEqual({
      ok: false,
      error: "broken",
    });
    const cut = gzipSync(
      entry({ name: "package/SKILL.md", text: "x".repeat(2000) }).subarray(0, 1024),
    );
    expect(readTarGz(cut)).toStrictEqual({ ok: false, error: "broken" });
  });

  it("refuses an archive that unpacks past 16 MiB", () => {
    const big = gzipSync(new Uint8Array(17 * 1024 * 1024));
    expect(readTarGz(big)).toStrictEqual({ ok: false, error: "too_large" });
  });
});
