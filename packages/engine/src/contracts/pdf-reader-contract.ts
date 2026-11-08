import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { imageTypeOf } from "@binference/protocol";
import type { PdfRequest } from "../documents/pdf-records.js";
import type { PdfReader } from "../documents/ports.js";

/**
 * A PDF reader under test and the documents it reads, each made in the adapter's own form: a text
 * PDF of two pages whose first page holds `word` and each page at least 200 characters, a scanned
 * one of one page with a picture and no text, an encrypted one whose page holds `word`, and bytes
 * that are no PDF.
 */
export interface PdfReaderSubject {
  readonly reader: PdfReader;
  readonly word: string;
  readonly text: Readonly<Uint8Array>;
  readonly scanned: Readonly<Uint8Array>;
  readonly locked: { readonly bytes: Readonly<Uint8Array>; readonly password: string };
  readonly notPdf: Readonly<Uint8Array>;
}

/** Makes a fresh {@link PdfReaderSubject} for each check. */
export interface PdfReaderHarness {
  create(): Promise<PdfReaderSubject>;
}

type Check = (subject: PdfReaderSubject) => Promise<void>;

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function read(subject: PdfReaderSubject, request: PdfRequest) {
  return subject.reader.read(request, live());
}

const readsText: Check = async (subject) => {
  const done = await read(subject, { bytes: subject.text });
  assert.ok(done.ok);
  const { totalPages, pages, textCut, pagesCut, imagesCut } = done.value;
  assert.equal(totalPages, 2);
  assert.deepEqual(
    pages.map((each) => each.page),
    [1, 2],
  );
  assert.ok(pages[0]?.text.includes(subject.word));
  assert.ok(pages.every((each) => each.picture === undefined));
  assert.deepEqual([textCut, pagesCut, imagesCut], [false, false, false]);
};

const readsAskedPages: Check = async (subject) => {
  const done = await read(subject, { bytes: subject.text, pages: [2, 5] });
  assert.ok(done.ok);
  assert.deepEqual(
    done.value.pages.map((each) => each.page),
    [2],
  );
  assert.equal(done.value.pagesCut, true);
  const none = await read(subject, { bytes: subject.text, pages: [7] });
  assert.deepEqual(none, { ok: false, error: "no_pages" });
};

const drawsScannedPages: Check = async (subject) => {
  const done = await read(subject, { bytes: subject.scanned });
  assert.ok(done.ok);
  const picture = done.value.pages[0]?.picture;
  assert.ok(picture !== undefined);
  assert.equal(imageTypeOf(picture), "image/jpeg");
  assert.equal(done.value.pages[0]?.text.trim(), "");
};

const opensWithPassword: Check = async (subject) => {
  const { bytes, password } = subject.locked;
  assert.deepEqual(await read(subject, { bytes }), { ok: false, error: "password" });
  const wrong = await read(subject, { bytes, password: `${password}x` });
  assert.deepEqual(wrong, { ok: false, error: "password" });
  const opened = await read(subject, { bytes, password });
  assert.ok(opened.ok);
  assert.ok(opened.value.pages[0]?.text.includes(subject.word));
};

const refusesNoPdf: Check = async (subject) => {
  assert.deepEqual(await read(subject, { bytes: subject.notPdf }), {
    ok: false,
    error: "not_pdf",
  });
};

const stopsOnAbort: Check = async (subject) => {
  const stopped = new Error("stopped");
  const stop = new AbortController();
  stop.abort(stopped);
  await assert.rejects(subject.reader.read({ bytes: subject.text }, stop), stopped);
};

const checks: readonly (readonly [string, Check])[] = [
  ["reads each page's text in order with the page count, nothing cut", readsText],
  ["reads only the pages asked for, and refuses when none is in the PDF", readsAskedPages],
  ["draws a JPEG of a page with too little text", drawsScannedPages],
  ["opens an encrypted PDF only with its password", opensWithPassword],
  ["refuses bytes that are no PDF", refusesNoPdf],
  ["rejects with the signal's reason once it aborts", stopsOnAbort],
];

/** The contract every `PdfReader` adapter passes. */
export function pdfReaderContract(harness: PdfReaderHarness): readonly ContractCheck[] {
  return checks.map(([name, check]) => ({
    name,
    run: async () => check(await harness.create()),
  }));
}
