import { type Clock, createDeadline, err, ok, type Random, type Result } from "@binference/core";
import {
  imageTypeOf,
  maxImageBytes,
  fileLimits,
  type ProtocolErrorCode,
  type ResultOf,
} from "@binference/protocol";
import type { HeldImage } from "../chat/image-hold.js";
import { imagePartOf } from "../chat/image-part.js";
import type { ViewImageRefusal, ViewImageSource } from "../chat/ports.js";
import type { RunningTurns } from "../chat/running-turns.js";
import type { EngineHandler } from "../operations/engine-call.js";
import { opensAsPdf } from "./pdf-head.js";
import { createPdfPictures, type PdfPictures } from "./pdf-pictures.js";
import type { PdfContent, PdfRefusal, PdfRequest } from "./pdf-records.js";
import type { PdfReader } from "./ports.js";

/** The operations the agent reads PDFs with (protocol spec, section 7.13). */
export interface PdfHandlers {
  readonly "pdf/read": EngineHandler<"pdf/read">;
  readonly "pdf/pageImage": EngineHandler<"pdf/pageImage">;
}

/** What the PDF handlers read through. */
export interface PdfHandlerOptions {
  /** The token of the runtime's current start, the one caller the handlers answer. */
  readonly turns: Pick<RunningTurns, "isRuntime">;
  readonly clock: Clock;
  /** The random bytes of each document's id. */
  readonly random: Random;
  /** Where a PDF's bytes come from, as a viewed image's do; without it every read is refused. */
  readonly source?: ViewImageSource;
  /** What reads a PDF's pages; without it every read is refused. */
  readonly reader?: PdfReader;
}

/** How long one PDF may take to read before it is stopped. */
export const pdfReadMs = 30_000;

const sourceCodes: Readonly<Record<ViewImageRefusal, ProtocolErrorCode>> = {
  not_found: "pdf.not_found",
  too_large: "pdf.too_large",
  walled: "pdf.walled",
  outside_workspace: "pdf.outside_workspace",
  not_public: "pdf.not_public",
  unreadable: "pdf.unreadable",
};

const readerCodes: Readonly<Record<PdfRefusal, ProtocolErrorCode>> = {
  not_pdf: "pdf.not_pdf",
  password: "pdf.password",
  no_pages: "pdf.no_pages",
  unreadable: "pdf.unreadable",
  timed_out: "pdf.timed_out",
};

// Reads the pages within the time one PDF has; a read the deadline stopped is `timed_out`.
async function readWithin(
  options: { readonly reader: PdfReader; readonly clock: Clock },
  request: PdfRequest,
  signal: AbortSignal,
): Promise<Result<PdfContent, PdfRefusal>> {
  const deadline = createDeadline({ clock: options.clock, signal, timeoutMs: pdfReadMs });
  try {
    return await options.reader.read(request, { signal: deadline.signal });
  } catch (error) {
    signal.throwIfAborted();
    if (deadline.signal.aborted) {
      return err("timed_out");
    }
    throw error;
  } finally {
    deadline.clear();
  }
}

/** A page's picture the agent can read, held by its page; none past the image limit. */
function heldPicture(picture: Readonly<Uint8Array> | undefined): HeldImage | undefined {
  const contentType = picture === undefined ? undefined : imageTypeOf(picture);
  if (picture === undefined || contentType === undefined || picture.byteLength > maxImageBytes) {
    return undefined;
  }
  return { contentType, bytes: picture };
}

type ReadPdfAnswer = ResultOf<"pdf/read">;
type PdfPageView = ReadPdfAnswer["pages"][number];

function answerOf(
  content: PdfContent,
  document: string,
): { readonly answer: ReadPdfAnswer; readonly pictures: ReadonlyMap<number, HeldImage> } {
  const pictures = new Map<number, HeldImage>();
  let imagesCut = content.imagesCut;
  const pages = content.pages.map((page): PdfPageView => {
    const held = heldPicture(page.picture);
    imagesCut ||= page.picture !== undefined && held === undefined;
    if (held === undefined) {
      return { page: page.page, text: page.text };
    }
    pictures.set(page.page, held);
    const image = { contentType: held.contentType, bytes: held.bytes.byteLength };
    return { page: page.page, text: page.text, image };
  });
  const { totalPages, textCut, pagesCut } = content;
  return { answer: { document, totalPages, pages, textCut, pagesCut, imagesCut }, pictures };
}

type ReadPdfArgs = Parameters<EngineHandler<"pdf/read">>[0]["args"];

// The PDF's bytes from its place, refused unless they open as a PDF.
async function fetchPdf(
  source: ViewImageSource,
  args: ReadPdfArgs,
  signal: AbortSignal,
): Promise<Result<Readonly<Uint8Array>, ProtocolErrorCode>> {
  const { url, path } = args;
  const place = url === undefined ? { path: path ?? "" } : { url };
  const file = await source.read(place, { signal, maxBytes: fileLimits.maxPdfBytes });
  if (!file.ok) {
    return err(sourceCodes[file.error]);
  }
  return opensAsPdf(file.value) ? ok(file.value) : err("pdf.not_pdf");
}

function readHandler(options: PdfHandlerOptions, held: PdfPictures): EngineHandler<"pdf/read"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { source, reader, clock } = options;
    if (source === undefined || reader === undefined) {
      return err("pdf.unreadable");
    }
    const file = await fetchPdf(source, call.args, call.signal);
    if (!file.ok) {
      return file;
    }
    const { agent, pages, password } = call.args;
    const request = {
      bytes: file.value,
      ...(pages === undefined ? {} : { pages }),
      ...(password === undefined ? {} : { password }),
    };
    const read = await readWithin({ reader, clock }, request, call.signal);
    if (!read.ok) {
      return err(readerCodes[read.error]);
    }
    const document = Buffer.from(options.random.bytes(8)).toString("hex");
    const { answer, pictures } = answerOf(read.value, document);
    if (pictures.size > 0) {
      held.keep(agent, document, pictures);
    }
    return ok(answer);
  };
}

function pageImageHandler(
  options: PdfHandlerOptions,
  held: PdfPictures,
): EngineHandler<"pdf/pageImage"> {
  return async (call) => {
    if (!options.turns.isRuntime(call.caller.credential)) {
      return err("auth.scope");
    }
    const { agent, document, page, offset = 0 } = call.args;
    const picture = held.find(agent, document, page);
    if (picture === "gone") {
      return err("pdf.gone");
    }
    if (picture === undefined || offset >= picture.bytes.byteLength) {
      return err("protocol.bad_args");
    }
    const part = imagePartOf(picture, offset);
    if (part.next === undefined) {
      held.drop(agent, document, page);
    }
    return Promise.resolve(ok(part));
  };
}

/**
 * Creates the handlers of `pdf/read` and `pdf/pageImage` (decision 0402): only the runtime the
 * engine runs now reads. A PDF's bytes come through the viewed images' source, at most 10 MiB, as
 * `file/read` reads a path or from a public address; the reader has 30 seconds to read its pages.
 * The pictures it drew are held for `pdf/pageImage` to read in parts. The password reaches the
 * reader alone, and nothing it read is kept past the pictures' hold.
 */
export function createPdfHandlers(options: PdfHandlerOptions): PdfHandlers {
  const held = createPdfPictures(options.clock);
  return {
    "pdf/read": readHandler(options, held),
    "pdf/pageImage": pageImageHandler(options, held),
  };
}
