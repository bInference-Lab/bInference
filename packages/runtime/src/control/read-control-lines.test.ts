import { describe, expect, it } from "vitest";
import { maxControlLineBytes, readControlLines } from "./read-control-lines.js";

async function* chunks(...parts: readonly (string | Uint8Array)[]): AsyncGenerator<Uint8Array> {
  const encoder = new TextEncoder();
  for (const part of parts) {
    yield typeof part === "string" ? encoder.encode(part) : part;
  }
}

async function collect(input: AsyncIterable<Uint8Array>): Promise<readonly string[]> {
  const lines: string[] = [];
  for await (const line of readControlLines(input)) {
    lines.push(line);
  }
  return lines;
}

describe("readControlLines", () => {
  it("cuts lines on LF and CR LF across chunks and skips empty lines", async () => {
    await expect(collect(chunks('{"a":', '1}\r\n\n{"b"', ":2}\n", "rest"))).resolves.toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  it("keeps a character whose bytes arrive in two chunks", async () => {
    const bytes = new TextEncoder().encode("€ü\n");
    await expect(collect(chunks(bytes.subarray(0, 2), bytes.subarray(2)))).resolves.toEqual(["€ü"]);
  });

  it("refuses a line longer than the limit before it ends", async () => {
    const long = "x".repeat(maxControlLineBytes + 1);
    await expect(collect(chunks(long))).rejects.toMatchObject({ code: "runtime.line_too_long" });
    await expect(collect(chunks(`${long}\n`))).rejects.toMatchObject({
      code: "runtime.line_too_long",
    });
  });
});
