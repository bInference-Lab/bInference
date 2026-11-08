import type { Result } from "@binference/core";
import type { PdfContent, PdfRefusal, PdfRequest } from "./pdf-records.js";

/**
 * Reads the pages of a PDF for the agent (decision 0402): each page's text, and a JPEG of each page
 * whose text has fewer than 200 characters, a scanned page, all of them within 4 million pixels.
 * It reads at most 20 pages and 100,000 characters, and says what it cut. It runs away from the
 * engine's event loop and stops a read past its own time limit as `timed_out`; it rejects with
 * the signal's reason once the signal aborts. The composition root builds it in
 * `@binference/pdf`. The password is never logged.
 */
export interface PdfReader {
  read(
    request: PdfRequest,
    call: { readonly signal: AbortSignal },
  ): Promise<Result<PdfContent, PdfRefusal>>;
}
