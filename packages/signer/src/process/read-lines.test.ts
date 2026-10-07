import { describe, expect, it } from "vitest";
import { maxLineBytes, readLines } from "./read-lines.js";

async function* chunksOf(...chunks: readonly Uint8Array[]): AsyncGenerator<Uint8Array> {
  yield* chunks;
}

async function linesOf(...chunks: readonly string[]): Promise<readonly string[]> {
  const lines: string[] = [];
  for await (const line of readLines(chunksOf(...chunks.map((chunk) => Buffer.from(chunk))))) {
    lines.push(line.toString("utf8"));
  }
  return lines;
}

describe("signer lines", () => {
  it("cuts LF and CR LF lines, across chunks and several in one chunk", async () => {
    await expect(linesOf("one\ntwo\r\nthr", "ee\n", "\nfour\r", "\n")).resolves.toStrictEqual([
      "one",
      "two",
      "three",
      "",
      "four",
    ]);
  });

  it("drops text after the last line break", async () => {
    await expect(linesOf("one\ntw")).resolves.toStrictEqual(["one"]);
  });

  it("zeroes every chunk it took", async () => {
    const chunks = [Buffer.from("secret key text\nre"), Buffer.from("quest\n")];
    const lines: string[] = [];
    for await (const line of readLines(chunksOf(...chunks))) {
      lines.push(line.toString("utf8"));
    }

    expect(lines).toStrictEqual(["secret key text", "request"]);
    expect(chunks.map((chunk) => chunk.every((byte) => byte === 0))).toStrictEqual([true, true]);
  });

  it("stops at a line over the limit, whole or still growing", async () => {
    const long = "x".repeat(maxLineBytes + 1);

    await expect(linesOf(`${long}\n`)).rejects.toMatchObject({ code: "signer.line_too_long" });
    await expect(linesOf("ok\n", long)).rejects.toMatchObject({ code: "signer.line_too_long" });
  });

  it("takes a line of exactly the limit", async () => {
    const lines = await linesOf(`${"y".repeat(maxLineBytes)}\n`);

    expect(lines.map((line) => line.length)).toStrictEqual([maxLineBytes]);
  });
});
