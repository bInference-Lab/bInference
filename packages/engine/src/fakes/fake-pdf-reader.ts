import { err, ok } from "@binference/core";
import { fileLimits } from "@binference/protocol";
import { z } from "zod";
import type { PdfPage } from "../documents/pdf-records.js";
import type { PdfReader } from "../documents/ports.js";

/** A document the fake reads: its pages, a scanned one holding a picture, and its password. */
export interface FakePdf {
  readonly pages: readonly { readonly text: string; readonly scanned?: boolean }[];
  readonly password?: string;
}

const head = "%PDF-fake\n";
const fakePdfSchema: z.ZodType<FakePdf> = z.object({
  pages: z.array(z.object({ text: z.string(), scanned: z.boolean().exactOptional() })),
  password: z.string().exactOptional(),
});

/** The bytes of a document {@link createFakePdfReader} reads: a PDF's first bytes, then JSON. */
export function fakePdfBytes(document: FakePdf): Uint8Array {
  return new TextEncoder().encode(`${head}${JSON.stringify(document)}`);
}

function documentOf(bytes: Readonly<Uint8Array>): FakePdf | undefined {
  const text = new TextDecoder().decode(bytes);
  if (!text.startsWith(head)) {
    return undefined;
  }
  const parsed = fakePdfSchema.safeParse(JSON.parse(text.slice(head.length)));
  return parsed.success ? parsed.data : undefined;
}

// A JPEG's first bytes, then the page's number.
function pictureOf(page: number): Uint8Array {
  return new Uint8Array([0xff, 0xd8, 0xff, 0xe0, page % 256]);
}

function chosenPages(document: FakePdf, asked: readonly number[] | undefined): readonly number[] {
  const total = document.pages.length;
  const wanted = asked ?? document.pages.map((_page, index) => index + 1);
  return wanted.filter((page) => page <= total).slice(0, fileLimits.maxPdfPages);
}

// Each page's text, cut once the document's text reaches its limit, and a scanned page's picture.
function readPages(document: FakePdf, pages: readonly number[]) {
  let left = fileLimits.maxPdfTextChars;
  let textCut = false;
  const read: PdfPage[] = pages.map((page) => {
    const { text: full, scanned } = document.pages[page - 1] ?? { text: "" };
    const text = full.slice(0, left);
    left -= text.length;
    textCut ||= text.length < full.length;
    return { page, text, ...(scanned === true ? { picture: pictureOf(page) } : {}) };
  });
  return { read, textCut };
}

/**
 * An in-memory {@link PdfReader} for tests over the documents {@link fakePdfBytes} makes: every
 * page's text, a JPEG's first bytes for a scanned page, the password checked, text cut at 100,000
 * characters. A read that `slow` holds waits for its signal.
 */
export function createFakePdfReader(options: { readonly slow?: boolean } = {}): PdfReader {
  return {
    async read(request, call) {
      call.signal.throwIfAborted();
      if (options.slow === true) {
        await new Promise<never>((_resolve, reject) => {
          call.signal.addEventListener("abort", () => {
            reject(call.signal.reason);
          });
        });
      }
      const document = documentOf(request.bytes);
      if (document === undefined) {
        return err("not_pdf");
      }
      if (document.password !== undefined && document.password !== request.password) {
        return err("password");
      }
      const pages = chosenPages(document, request.pages);
      if (pages.length === 0) {
        return err("no_pages");
      }
      const { read, textCut } = readPages(document, pages);
      return ok({
        totalPages: document.pages.length,
        pages: read,
        textCut,
        pagesCut: pages.length < (request.pages?.length ?? document.pages.length),
        imagesCut: false,
      });
    },
  };
}
