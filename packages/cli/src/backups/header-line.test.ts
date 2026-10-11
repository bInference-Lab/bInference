import { idSchema } from "@binference/core";
import { describe, expect, it } from "vitest";
import { joined, piecesOf, valueOf } from "./backup-fixtures.js";
import type { BackupHeader } from "./backup-header.schema.js";
import { headerLine, parseHeader, splitHeader } from "./header-line.js";

const header: BackupHeader = {
  format: "binference-backup",
  version: 2,
  installId: idSchema("ins").parse("ins_0190f1c2-3a4b-7c5d-8e6f-000000000001"),
  createdAt: 1_800_000_000_000,
  kind: "weekly",
  binferenceVersion: "1.2.3",
  cipher: "aes-256-gcm-stream",
  chunkBytes: 65_536,
  noncePrefix: Buffer.alloc(8, 1).toString("base64"),
  wrappedKey: Buffer.alloc(113, 2).toString("base64"),
};
const text = (line: Uint8Array): string => Buffer.from(line).toString("utf8");
const bytes = (value: string): Buffer => Buffer.from(value, "utf8");

describe("a backup's header line", () => {
  it("writes the keys in the spec's order, on one line", () => {
    const line = text(headerLine({ ...header, wrappedKey: header.wrappedKey }));

    expect(line).not.toContain("\n");
    expect(Object.keys(JSON.parse(line) as object)).toStrictEqual([
      "format",
      "version",
      "installId",
      "createdAt",
      "kind",
      "binferenceVersion",
      "cipher",
      "chunkBytes",
      "noncePrefix",
      "wrappedKey",
    ]);
  });

  it("reads back the header it wrote", () => {
    expect(parseHeader(headerLine(header))).toStrictEqual({ ok: true, value: header });
  });

  it("tells a later format version from no backup at all", () => {
    const later = bytes(JSON.stringify({ ...header, version: 3, extra: true }));

    expect(parseHeader(later)).toStrictEqual({ ok: false, error: "newer_version" });
    expect(parseHeader(bytes("{ version: 4 }"))).toStrictEqual({
      ok: false,
      error: "not_a_backup",
    });
    expect(parseHeader(bytes(JSON.stringify({ ...header, cipher: "none" })))).toStrictEqual({
      ok: false,
      error: "not_a_backup",
    });
    expect(parseHeader(Buffer.of(0xff, 0xfe))).toStrictEqual({ ok: false, error: "not_a_backup" });
  });

  it("splits a file after its first line, whatever pieces it is read in", async () => {
    const file = bytes(`${text(headerLine(header))}\nbody bytes`);
    const pieces = [file.subarray(0, 10), file.subarray(10, 400), file.subarray(400)];

    const split = valueOf(await splitHeader(piecesOf(pieces)));

    expect(text(split.line)).toBe(text(headerLine(header)));
    expect((await joined(split.body)).toString("utf8")).toBe("body bytes");
  });

  it("finds no header in a file whose first 4 KiB hold no line break", async () => {
    const split = await splitHeader(piecesOf([Buffer.alloc(5_000, 0x61), bytes("\n")]));

    expect(split).toStrictEqual({ ok: false, error: "not_a_backup" });
  });
});
