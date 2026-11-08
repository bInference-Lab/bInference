import { BinferenceError, err, ok, type Result } from "@binference/core";
import type { ResultOf } from "@binference/protocol";
import { readPagedImage } from "../images/paged-image.js";
import type { ModelImage } from "../loop/model-message.js";
import { filePathOf } from "../tools/image-places.js";
import type { AgentToolParts } from "../tools/tool-client.js";

/** A PDF the engine read, by the name the agent gave it. */
export interface ReadPdf {
  readonly name: string;
  readonly read: ResultOf<"pdf/read">;
}

/** The pages and password every PDF of one call is read with. */
export interface PdfAsk {
  readonly pages?: readonly number[];
  readonly password?: string;
}

/** What the agent reads for each refusal of a PDF, by the engine's code. */
const pdfRefusals: Readonly<Record<string, string>> = {
  "pdf.not_found":
    "there is no PDF there: the address answered with an error, or no file has that path.",
  "pdf.too_large": "the PDF is over 10 MiB, which read_pdf does not read.",
  "pdf.walled":
    "that file is inside binference's own folder, which is walled off. Never try to reach it another way.",
  "pdf.outside_workspace":
    "the owner keeps your files inside your workspace (files.workspaceOnly), so that file is refused.",
  "pdf.not_public":
    "that address is not on the public internet: read_pdf never reaches a local, private or metadata address.",
  "pdf.not_pdf": "that is no PDF.",
  "pdf.password":
    "the PDF is encrypted, and no password or a wrong one was given. Ask the owner for its password and pass it as password.",
  "pdf.no_pages": "none of the pages asked for are in the PDF.",
  "pdf.timed_out": "reading the PDF took over 30 seconds. Ask for fewer pages.",
  "pdf.unreadable": "the PDF could not be read. Try again, or ask the owner to send it.",
};

// The most pictures, and their most bytes, one call hands a model, whatever the PDFs hold.
const maxPictures = 20;
const maxPictureBytes = 16 * 1024 * 1024;

// Where a PDF is: a public address, or a path; another kind of address is refused.
function pdfPlaceOf(written: string): Result<{ url: string } | { path: string }, string> {
  if (/^https?:\/\//iu.test(written)) {
    return ok({ url: written });
  }
  if (/^[a-z][a-z0-9+.-]+:/iu.test(written) && !/^file:/iu.test(written)) {
    return err(`${written}: name a file path, a file:// address or an http(s) address.`);
  }
  return ok({ path: filePathOf(written) });
}

// The sentence a PDF's refusal reads as, naming the PDF.
function pdfRefusalText(name: string, code: string): string {
  return `${name}: ${pdfRefusals[code] ?? `read_pdf failed with ${code}.`}`;
}

/**
 * Reads each PDF through the engine's `pdf/read`, in order; the first a place or the engine
 * refuses answers its sentence. An error that is no refusal of the engine stays a fault.
 */
export async function readPdfs(
  parts: Pick<AgentToolParts, "agent" | "client">,
  names: readonly string[],
  ask: PdfAsk & { readonly signal: AbortSignal },
): Promise<Result<readonly ReadPdf[], string>> {
  const { signal, ...wanted } = ask;
  const reads: ReadPdf[] = [];
  for (const name of names) {
    const place = pdfPlaceOf(name);
    if (!place.ok) {
      return place;
    }
    try {
      const args = { agent: parts.agent, ...place.value, ...wanted };
      // oxlint-disable-next-line eslint/no-await-in-loop -- one PDF read at a time, in order
      reads.push({ name, read: await parts.client.call("pdf/read", args, { signal }) });
    } catch (error) {
      if (error instanceof BinferenceError && error.code.startsWith("pdf.")) {
        return err(pdfRefusalText(name, error.code));
      }
      throw error;
    }
  }
  return ok(reads);
}

// One page's picture, read part by part; none when the engine no longer holds it.
async function pictureOf(
  parts: Pick<AgentToolParts, "agent" | "client">,
  at: { readonly document: string; readonly page: number },
  signal: AbortSignal,
): Promise<ModelImage | undefined> {
  const read = await readPagedImage<string>({
    part: async (offset) => {
      try {
        const args = { agent: parts.agent, ...at, ...(offset === 0 ? {} : { offset }) };
        return ok(await parts.client.call("pdf/pageImage", args, { signal }));
      } catch (error) {
        signal.throwIfAborted();
        return err(error instanceof BinferenceError ? error.code : "unreadable");
      }
    },
    unreadable: "unreadable",
    tooLarge: "too_large",
  });
  return read.ok ? { contentType: read.value.contentType, data: read.value.data } : undefined;
}

/**
 * The pictures of the PDFs' scanned pages, in order, at most 20 and 16 MiB of them; a picture the
 * engine no longer holds is left out.
 */
export async function picturesOf(
  parts: Pick<AgentToolParts, "agent" | "client">,
  reads: readonly ReadPdf[],
  signal: AbortSignal,
): Promise<readonly ModelImage[]> {
  const pictures: ModelImage[] = [];
  let bytes = 0;
  const pages = reads.flatMap(({ read }) =>
    read.pages.flatMap((page) => (page.image === undefined ? [] : [{ read, page }])),
  );
  for (const { read, page } of pages.slice(0, maxPictures)) {
    bytes += page.image?.bytes ?? 0;
    if (bytes > maxPictureBytes) {
      break;
    }
    const at = { document: read.document, page: page.page };
    // oxlint-disable-next-line eslint/no-await-in-loop -- one picture read at a time, in order
    const picture = await pictureOf(parts, at, signal);
    if (picture !== undefined) {
      pictures.push(picture);
    }
  }
  return pictures;
}
