import { parentPort } from "node:worker_threads";
import { type PdfJob, type PdfJobAnswer, pdfJobOf } from "./pdf-job.schema.js";
import { readPdf } from "./read-pdf.js";

// One worker thread reads one PDF and answers once; the reader ends the thread after. A failure
// answers no reason: a PDF's own words, or its password, never leave the thread in an error.
async function answer(job: PdfJob | undefined): Promise<PdfJobAnswer> {
  if (job === undefined) {
    return { kind: "failed" };
  }
  try {
    const read = await readPdf(job);
    return read.ok
      ? { kind: "read", content: read.value }
      : { kind: "refused", refusal: read.error };
  } catch {
    return { kind: "failed" };
  }
}

async function serve(job: PdfJob | undefined): Promise<void> {
  parentPort?.postMessage(await answer(job), []);
}

parentPort?.once("message", (value) => {
  void serve(pdfJobOf(value));
});
