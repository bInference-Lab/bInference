import { createManualClock } from "@binference/core/testing";
import { pdfReaderContract } from "@binference/engine/testing";
import { fileLimits, imageTypeOf } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { createPdfReader, pdfReadLimitMs, pdfWorker } from "./create-pdf-reader.js";
import { makeTestPdf } from "./test-pdfs.js";

// The worker thread loads the TypeScript sources, as the tests do.
const execArgv = ["--conditions=@binference/source", "--import", "tsx"];
const reader = createPdfReader({ worker: pdfWorker, execArgv, clock: createManualClock(0) });
const live = () => ({ signal: new AbortController().signal });
const word = "harbour";
// Lines of prose, enough that a page reads as text, not as a scan.
const prose = (first: string) => [
  `${first} holds the supply and its vesting.`,
  ...Array.from(
    { length: 8 },
    (_line, index) => `Line ${String(index + 1)} of the plain prose here.`,
  ),
];

type Read = Awaited<ReturnType<typeof reader.read>>;

// The pages a read answered, none for a refusal.
function pagesOf(read: Read) {
  return read.ok ? read.value.pages : [];
}

// The first page's picture, no bytes when it has none.
function firstPictureOf(read: Read): Readonly<Uint8Array> {
  return pagesOf(read)[0]?.picture ?? new Uint8Array();
}

describe("the PDF reader", () => {
  it.each(
    pdfReaderContract({
      create: async () =>
        Promise.resolve({
          reader,
          word,
          text: makeTestPdf([{ lines: prose(word) }, { lines: prose("Second") }]),
          scanned: makeTestPdf([{ picture: { width: 40, height: 30 } }]),
          locked: {
            bytes: makeTestPdf([{ lines: prose(word) }], "s3cret"),
            password: "s3cret",
          },
          notPdf: new TextEncoder().encode("%PDF-1.4\na header and nothing else"),
        }),
    }),
  )("follows the contract: $name", { timeout: 20_000 }, async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("reads the first 20 pages of a longer PDF and cuts the text at its limit", async () => {
    const line = "x".repeat(120);
    // A wide page, so no line runs past its edge, where pdf.js leaves text out.
    const page = { lines: Array.from({ length: 50 }, () => line), size: [1_224, 792] as const };
    const read = await reader.read(
      { bytes: makeTestPdf(Array.from({ length: 25 }, () => page)) },
      live(),
    );
    expect(read).toMatchObject({
      ok: true,
      value: { totalPages: 25, pagesCut: true, textCut: true },
    });
    const texts = pagesOf(read).map((each) => each.text.length);
    expect(texts).toHaveLength(fileLimits.maxPdfPages);
    expect(texts.reduce((sum, length) => sum + length, 0)).toBe(fileLimits.maxPdfTextChars);
  }, 20_000);

  it("draws a large scanned page smaller, within its pixels, and says so", async () => {
    const big = { picture: { width: 60, height: 80 }, size: [3_000, 4_000] as const };
    const read = await reader.read({ bytes: makeTestPdf([big]) }, live());
    expect(read).toMatchObject({ ok: true, value: { imagesCut: true } });
    expect(imageTypeOf(firstPictureOf(read))).toBe("image/jpeg");
  }, 20_000);

  it("ends a read that runs past its time", async () => {
    const clock = createManualClock(0);
    const slow = createPdfReader({ worker: pdfWorker, execArgv, clock });
    const read = slow.read({ bytes: makeTestPdf([{ lines: prose(word) }]) }, live());
    await clock.advance(pdfReadLimitMs);
    expect(await read).toStrictEqual({ ok: false, error: "timed_out" });
  });
});
