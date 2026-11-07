import { describe, expect, it } from "vitest";
import { readPage } from "./read-page.js";

const file = (text: string) => ({ path: "/w/a.md", text });
const numbered = (count: number) =>
  Array.from({ length: count }, (_, index) => `line ${String(index + 1)}`).join("\n");

describe("readPage", () => {
  it("answers the whole of a short file, a last line break opening no line", () => {
    expect(readPage(file("one\r\ntwo\n"), {})).toStrictEqual({
      ok: true,
      value: {
        kind: "text",
        path: "/w/a.md",
        text: "one\ntwo",
        startLine: 1,
        endLine: 2,
        totalLines: 2,
      },
    });
  });

  it("pages 2,000 lines at most and names where the next page starts", () => {
    const page = readPage(file(Array.from({ length: 2_500 }, () => "x").join("\n")), {});
    expect(page).toMatchObject({
      ok: true,
      value: {
        startLine: 1,
        endLine: 2_000,
        totalLines: 2_500,
        next: { offset: 2_001, cutBy: "lines" },
      },
    });
  });

  it("reads from an offset for a limit, and names the rest", () => {
    expect(readPage(file(numbered(10)), { offset: 4, limit: 2 })).toMatchObject({
      ok: true,
      value: {
        text: "line 4\nline 5",
        startLine: 4,
        endLine: 5,
        next: { offset: 6, cutBy: "lines" },
      },
    });
    expect(readPage(file(numbered(10)), { offset: 9 })).toMatchObject({
      ok: true,
      value: { text: "line 9\nline 10", endLine: 10 },
    });
  });

  it("cuts a page at 10 KiB of text, and a first line longer than that", () => {
    const wide = "x".repeat(6 * 1024);
    expect(readPage(file(`${wide}\n${wide}\n${wide}`), {})).toMatchObject({
      ok: true,
      value: { endLine: 1, next: { offset: 2, cutBy: "bytes" } },
    });
    const page = readPage(file("é".repeat(8 * 1024)), {}) as {
      readonly value: { readonly text: string };
    };
    expect(new TextEncoder().encode(page.value.text).byteLength).toBe(10 * 1024);
  });

  it("refuses an offset past the last line, and reads an empty file", () => {
    expect(readPage(file("a\nb"), { offset: 3 })).toStrictEqual({
      ok: false,
      error: "file.offset_past_end",
    });
    expect(readPage(file(""), {})).toMatchObject({
      ok: true,
      value: { text: "", endLine: 0, totalLines: 0 },
    });
  });
});
