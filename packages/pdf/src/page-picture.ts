import { maxImageBytes } from "@binference/protocol";
import { type Canvas, createCanvas } from "@napi-rs/canvas";
import type { PDFPageProxy } from "pdfjs-dist/legacy/build/pdf.mjs";

/** A page drawn as a JPEG, the pixels it took, and whether it was drawn smaller than 96 dpi. */
export interface PagePicture {
  readonly jpeg: Uint8Array;
  readonly pixels: number;
  readonly reduced: boolean;
}

// A page is drawn at 96 dots per inch, as a screen shows it, unless that is over its share of the
// pixels; no edge is ever over 10,000 pixels.
const screenScale = 96 / 72;
const maxEdge = 10_000;
// JPEG qualities tried in turn until the picture fits one image the agent reads.
const qualities = [80, 55, 30] as const;

/** The scale a page of `width` by `height` points is drawn at to stay within `maxPixels`. */
export function scaleFor(width: number, height: number, maxPixels: number): number {
  const area = width * height;
  if (!Number.isFinite(area) || area <= 0 || maxPixels < 1) {
    return 0;
  }
  const fitting = Math.sqrt(maxPixels / area);
  const edge = maxEdge / Math.max(width, height);
  return Math.min(screenScale, fitting, edge);
}

async function encoded(canvas: Canvas): Promise<Uint8Array | undefined> {
  for (const quality of qualities) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- each quality is tried only when the last was too large
    const jpeg = await canvas.encode("jpeg", quality);
    if (jpeg.byteLength <= maxImageBytes) {
      return new Uint8Array(jpeg);
    }
  }
  return undefined;
}

/**
 * Draws a page on a white ground as a JPEG of at most `maxPixels` pixels and 5 MiB, or answers
 * `undefined` when it cannot be drawn within them.
 */
export async function drawPage(
  page: PDFPageProxy,
  maxPixels: number,
): Promise<PagePicture | undefined> {
  const whole = page.getViewport({ scale: 1 });
  const scale = scaleFor(whole.width, whole.height, maxPixels);
  const viewport = page.getViewport({ scale });
  const width = Math.floor(viewport.width);
  const height = Math.floor(viewport.height);
  if (width < 1 || height < 1) {
    return undefined;
  }
  const canvas = createCanvas(width, height);
  const context = canvas.getContext("2d");
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, width, height);
  await page.render({ canvas, viewport }).promise;
  const jpeg = await encoded(canvas);
  return jpeg === undefined
    ? undefined
    : { jpeg, pixels: width * height, reduced: scale < screenScale };
}
