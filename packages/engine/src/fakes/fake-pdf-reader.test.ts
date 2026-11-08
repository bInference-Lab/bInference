import { fileLimits } from "@binference/protocol";
import { describe, expect, it } from "vitest";
import { pdfReaderContract } from "../contracts/pdf-reader-contract.js";
import { createFakePdfReader, fakePdfBytes } from "./fake-pdf-reader.js";

const word = "harbour";
const long = (text: string) => `${text} `.repeat(40);

describe("the fake PDF reader", () => {
  it.each(
    pdfReaderContract({
      create: async () =>
        Promise.resolve({
          reader: createFakePdfReader(),
          word,
          text: fakePdfBytes({ pages: [{ text: long(word) }, { text: long("second") }] }),
          scanned: fakePdfBytes({ pages: [{ text: "", scanned: true }] }),
          locked: {
            bytes: fakePdfBytes({ pages: [{ text: long(word) }], password: "s3cret" }),
            password: "s3cret",
          },
          notPdf: new TextEncoder().encode("plain text"),
        }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("cuts the text at its limit and reads the first 20 pages of a longer document", async () => {
    const page = { text: "x".repeat(fileLimits.maxPdfTextChars / 4) };
    const bytes = fakePdfBytes({ pages: Array.from({ length: 25 }, () => page) });
    const read = await createFakePdfReader().read(
      { bytes },
      { signal: new AbortController().signal },
    );
    expect(read).toMatchObject({
      ok: true,
      value: { totalPages: 25, textCut: true, pagesCut: true },
    });
  });
});
