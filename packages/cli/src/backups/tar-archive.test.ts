import { describe, expect, it } from "vitest";
import { joined, piecesOf } from "./backup-fixtures.js";
import { readTar, paxFields } from "./tar-reader.js";
import { blockBytes, headerBlock, paxRecord, type TarFile, writeTar } from "./tar-writer.js";

const bytesOf = (...pieces: readonly Uint8Array[]): AsyncGenerator<Uint8Array> => piecesOf(pieces);

function fileOf(path: string, text: string): TarFile {
  const bytes = Buffer.from(text, "utf8");
  return { path, bytes: bytes.length, content: bytesOf(bytes) };
}

async function archiveOf(files: readonly TarFile[]): Promise<Buffer> {
  return joined(writeTar(files, { mtimeMs: 1_800_000_000_000 }));
}

async function filesIn(archive: Uint8Array): Promise<readonly [string, string][]> {
  const read: [string, string][] = [];
  await readTar(bytesOf(archive), async (entry, content) => {
    const bytes = await joined(content);
    expect(bytes).toHaveLength(entry.bytes);
    read.push([entry.path, bytes.toString("utf8")]);
  });
  return read;
}

const longPath = `workspace/${"agent/".repeat(30)}notes.md`;

describe("the backup's tar archive", () => {
  it("reads back each file it wrote, in order, long and non-ascii paths and empty files too", async () => {
    const files: [string, string][] = [
      ["engine.sqlite", "x".repeat(blockBytes)],
      [longPath, "deep"],
      ["workspace/agent/\u7b14\u8bb0.md", "\u4e2d\u6587"],
      ["workspace/agent/empty", ""],
      ["config.json5", "{ version: 4 }"],
    ];

    const archive = await archiveOf(files.map(([path, text]) => fileOf(path, text)));

    expect(archive.length % blockBytes).toBe(0);
    expect(await filesIn(archive)).toStrictEqual(files);
  });

  it("writes a ustar header with a checksum and owner-only mode", () => {
    const block = headerBlock({ name: "engine.sqlite", size: 1_024, type: "0" }, 1_800_000_000);

    expect(block).toHaveLength(blockBytes);
    expect(block.subarray(257, 265).toString("ascii")).toBe("ustar\u000000");
    expect(block.subarray(100, 108).toString("ascii")).toBe("0000600\u0000");
    expect(block.subarray(124, 136).toString("ascii")).toBe("00000002000\u0000");
  });

  it("counts a pax record's own digits in its length", () => {
    expect(paxRecord("path", "a").toString("utf8")).toBe("9 path=a\n");
    expect(paxRecord("path", "a".repeat(90)).toString("utf8")).toBe(`99 path=${"a".repeat(90)}\n`);
    expect(paxRecord("path", "a".repeat(91)).toString("utf8")).toBe(`101 path=${"a".repeat(91)}\n`);
    expect(paxFields(Buffer.from("9 path=a\n12 size=100\n"))).toStrictEqual(
      new Map([
        ["path", "a"],
        ["size", "100"],
      ]),
    );
  });

  it("refuses a file whose bytes do not match the size it was listed with", async () => {
    const short = { path: "config.json5", bytes: 10, content: bytesOf(Buffer.from("four")) };
    const long = { path: "config.json5", bytes: 2, content: bytesOf(Buffer.from("four")) };

    await expect(archiveOf([short])).rejects.toMatchObject({ code: "backup.file_changed" });
    await expect(archiveOf([long])).rejects.toMatchObject({ code: "backup.file_changed" });
  });

  it("refuses a changed header, an entry that is no file, a short archive and bytes after its end", async () => {
    const archive = await archiveOf([fileOf("config.json5", "{}")]);
    const changed = Buffer.from(archive);
    changed.writeUInt8(changed.readUInt8(0) ^ 1, 0);
    const folder = Buffer.from(archive);
    folder.write("5", 156, "ascii");
    const damaged = { code: "backup.archive_damaged" };

    await expect(filesIn(changed)).rejects.toMatchObject(damaged);
    await expect(filesIn(folder)).rejects.toMatchObject(damaged);
    await expect(filesIn(archive.subarray(0, archive.length - 1))).rejects.toMatchObject(damaged);
    await expect(filesIn(Buffer.concat([archive, Buffer.of(1)]))).rejects.toMatchObject(damaged);
  });
});
