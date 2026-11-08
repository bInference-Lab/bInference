import type { BrowserCapture } from "@binference/engine/browser";
import { browserLimits, maxImageBytes } from "@binference/protocol";
import type { Page } from "playwright-core";
import { z } from "zod";
import { cutAtLine } from "./page-snapshot.js";

/** A page's prose cut to fit, and whether anything was cut. */
export interface PageText {
  readonly text: string;
  readonly cut: boolean;
}

// The parts of a page that hold its prose, in the order they are tried.
const proseParts = ["article", "main", "body"] as const;

/**
 * The prose of the first element the selector finds, else of the page's article, main or body,
 * blank lines folded and cut to `maxChars`.
 */
export async function pageText(
  page: Page,
  call: { readonly selector?: string; readonly maxChars?: number; readonly timeoutMs: number },
): Promise<PageText> {
  const most = Math.min(
    call.maxChars ?? browserLimits.maxPageTextChars,
    browserLimits.maxPageTextChars,
  );
  const counts = await Promise.all(proseParts.map(async (part) => page.locator(part).count()));
  const part = call.selector ?? proseParts.find((_, at) => (counts[at] ?? 0) > 0) ?? "body";
  const raw = await page.locator(part).first().innerText({ timeout: call.timeoutMs });
  const folded = raw.replace(/\n{3,}/gu, "\n\n").trim();
  const cut = cutAtLine(folded, most);
  return { text: cut.snapshot, cut: cut.cut };
}

/**
 * A PNG of the page, the whole page with `fullPage`, or of the element a ref names; one over the
 * 5 MiB a model reads is taken again as a JPEG.
 */
export async function screenshotOf(
  page: Page,
  call: { readonly fullPage?: boolean; readonly ref?: string; readonly timeoutMs: number },
): Promise<BrowserCapture> {
  const timeout = call.timeoutMs;
  const shoot = async (type: "png" | "jpeg"): Promise<Uint8Array> => {
    const quality = type === "jpeg" ? { quality: 70 } : {};
    const options = { type, timeout, ...quality };
    return call.ref === undefined
      ? page.screenshot({ ...options, fullPage: call.fullPage === true })
      : page.locator(`aria-ref=${call.ref}`).screenshot(options);
  };
  const png = await shoot("png");
  if (png.byteLength <= maxImageBytes) {
    return { bytes: png, contentType: "image/png" };
  }
  return { bytes: await shoot("jpeg"), contentType: "image/jpeg" };
}

const printed = z.object({ data: z.base64() });

/**
 * The page printed as a PDF through the browser's DevTools protocol, which prints with a window
 * as well as without one, backgrounds included.
 */
export async function pdfOf(page: Page): Promise<BrowserCapture> {
  const session = await page.context().newCDPSession(page);
  try {
    const { data } = printed.parse(
      await session.send("Page.printToPDF", { printBackground: true }),
    );
    return { bytes: Buffer.from(data, "base64"), contentType: "application/pdf" };
  } finally {
    await session.detach();
  }
}
