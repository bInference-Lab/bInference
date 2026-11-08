import { fileURLToPath } from "node:url";
import { err, ok, type Result } from "@binference/core";
import type { PdfContent, PdfPage, PdfRefusal } from "@binference/engine/pdf";
import { fileLimits } from "@binference/protocol";
import {
  getDocument,
  type PDFDocumentProxy,
  type PDFPageProxy,
} from "pdfjs-dist/legacy/build/pdf.mjs";
import { drawPage } from "./page-picture.js";
import type { PdfJob } from "./pdf-job.schema.js";

// pdf.js reads its Adobe character maps, its standard fonts and its image decoders from its own
// folders, given as paths that end in a separator.
const pdfjsRoot = new URL("../../", import.meta.resolve("pdfjs-dist/legacy/build/pdf.mjs"));
const folderOf = (name: string): string => fileURLToPath(new URL(`${name}/`, pdfjsRoot));

// The most pixels pdf.js decodes for one picture inside a page, against a picture made to fill
// the memory of whoever opens it.
const maxDecodedPixels = 50_000_000;
async function open(job: PdfJob): Promise<Result<PDFDocumentProxy, PdfRefusal>> {
  const task = getDocument({
    data: job.bytes,
    ...(job.password === undefined ? {} : { password: job.password }),
    cMapUrl: folderOf("cmaps"),
    cMapPacked: true,
    standardFontDataUrl: folderOf("standard_fonts"),
    wasmUrl: folderOf("wasm"),
    iccUrl: folderOf("iccs"),
    useSystemFonts: false,
    disableFontFace: true,
    useWorkerFetch: false,
    maxImageSize: maxDecodedPixels,
    verbosity: 0,
  });
  try {
    return ok(await task.promise);
  } catch (error) {
    await task.destroy();
    const name = error instanceof Error ? error.name : "";
    if (name === "PasswordException") {
      return err("password");
    }
    return err(name === "InvalidPDFException" ? "not_pdf" : "unreadable");
  }
}

/** The pages to read: those asked for that the PDF has, or its first, at most 20. */
function chosenPages(
  total: number,
  asked: readonly number[] | undefined,
): { readonly pages: readonly number[]; readonly cut: boolean } {
  const wanted = asked ?? Array.from({ length: total }, (_page, index) => index + 1);
  const pages = wanted.filter((page) => page <= total).slice(0, fileLimits.maxPdfPages);
  return { pages, cut: pages.length < wanted.length };
}

async function textOf(page: PDFPageProxy): Promise<string> {
  const content = await page.getTextContent();
  const pieces = content.items.map((item) =>
    "str" in item ? `${item.str}${item.hasEOL ? "\n" : ""}` : "",
  );
  // Controls but tabs and line breaks never reach the agent.
  return pieces.join("").replaceAll(/(?![\t\n\r])\p{Cc}/gu, "");
}

// Text cut at `left` characters, never between the two halves of a surrogate pair.
function cut(text: string, left: number): string {
  const kept = text.slice(0, Math.max(0, left));
  return /[\uD800-\uDBFF]$/u.test(kept) ? kept.slice(0, -1) : kept;
}

/** Each page's text, together at most 100,000 characters. */
async function readTexts(
  document: PDFDocumentProxy,
  pages: readonly number[],
): Promise<{ readonly texts: readonly string[]; readonly textCut: boolean }> {
  const texts: string[] = [];
  let left = fileLimits.maxPdfTextChars;
  let textCut = false;
  for (const number of pages) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one page in memory at a time, in order
    const full = await textOf(await document.getPage(number));
    const text = cut(full, left);
    texts.push(text);
    left -= text.length;
    textCut ||= text.length < full.length;
  }
  return { texts, textCut };
}

/**
 * Draws each page whose text is too little, the pages sharing 4 million pixels: each takes its
 * share of what the pages before it left. A page that cannot be drawn is left out.
 */
async function drawPages(
  document: PDFDocumentProxy,
  pages: readonly number[],
): Promise<{ readonly pictures: ReadonlyMap<number, Uint8Array>; readonly imagesCut: boolean }> {
  const pictures = new Map<number, Uint8Array>();
  let left = fileLimits.maxPdfPixels;
  let imagesCut = false;
  for (const [index, number] of pages.entries()) {
    const share = Math.floor(left / (pages.length - index));
    // oxlint-disable-next-line eslint/no-await-in-loop -- one page drawn at a time, in order
    const drawn = await drawPage(await document.getPage(number), share).catch(() => undefined);
    imagesCut ||= drawn === undefined || drawn.reduced;
    if (drawn !== undefined) {
      pictures.set(number, drawn.jpeg);
      left -= drawn.pixels;
    }
  }
  return { pictures, imagesCut };
}

/**
 * Reads a PDF's pages (decision 0402): each page's text, and a JPEG of each page whose text has
 * fewer than 200 characters, within the protocol's limits on pages, text and pixels.
 */
export async function readPdf(job: PdfJob): Promise<Result<PdfContent, PdfRefusal>> {
  const opened = await open(job);
  if (!opened.ok) {
    return opened;
  }
  const document = opened.value;
  try {
    const { pages, cut: pagesCut } = chosenPages(document.numPages, job.pages);
    if (pages.length === 0) {
      return err("no_pages");
    }
    const { texts, textCut } = await readTexts(document, pages);
    const scanned = pages.filter(
      (_page, index) => (texts[index] ?? "").trim().length < fileLimits.minPageTextChars,
    );
    const { pictures, imagesCut } = await drawPages(document, scanned);
    const read = pages.map((page, index): PdfPage => {
      const picture = pictures.get(page);
      const text = texts[index] ?? "";
      return picture === undefined ? { page, text } : { page, text, picture };
    });
    return ok({ totalPages: document.numPages, pages: read, textCut, pagesCut, imagesCut });
  } finally {
    await document.loadingTask.destroy();
  }
}
