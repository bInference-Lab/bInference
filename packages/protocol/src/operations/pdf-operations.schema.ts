import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { maxPdfPages, maxPdfPasswordChars, maxPdfTextChars } from "./file-limits.js";
import {
  imageByteCountSchema,
  imageContentTypeSchema,
  type ImageContentType,
  type ImagePart,
  imagePartSchema,
} from "./image-operations.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/**
 * The args of `pdf/read`: a PDF at a public `http:` or `https:` address or in a file on the
 * engine's machine, exactly one of the two; the pages to read, 1-based, at most 20, all of the
 * first 20 when absent; and the password of an encrypted PDF.
 */
interface ReadPdfArgs {
  readonly agent: ProtocolId<"agent">;
  readonly url?: string;
  /** Read as `file/read` reads a path. */
  readonly path?: string;
  readonly pages?: readonly number[];
  /** Never logged, stored or answered. */
  readonly password?: string;
}

/** A page's picture the engine drew, which `pdf/pageImage` reads in parts. */
interface PdfPageImage {
  readonly contentType: ImageContentType;
  readonly bytes: number;
}

/** One page read: its number, its text, and its picture when its text was too little. */
interface PdfPageView {
  readonly page: number;
  readonly text: string;
  readonly image?: PdfPageImage;
}

/**
 * What `pdf/read` read: the pages in order, the document's page count, and what was cut: text
 * past 100,000 characters, pages past the 20 read or past the document's end, and pictures left
 * out or drawn smaller to keep within 4 million pixels.
 */
interface ReadPdfResult {
  /** The id `pdf/pageImage` reads the pictures by, held for 2 minutes. */
  readonly document: string;
  readonly totalPages: number;
  readonly pages: readonly PdfPageView[];
  readonly textCut: boolean;
  readonly pagesCut: boolean;
  readonly imagesCut: boolean;
}

/** The args of `pdf/pageImage`: one part of a page's picture, from `offset`. */
interface PdfPageImageArgs {
  readonly agent: ProtocolId<"agent">;
  readonly document: string;
  readonly page: number;
  readonly offset?: number;
}

/**
 * The operations the agent reads PDFs with (decision 0402). They take no idempotency key, so no
 * document's words, and no password, are ever stored.
 */
export interface PdfOperationShapes {
  readonly "pdf/read": { readonly args: ReadPdfArgs; readonly result: ReadPdfResult };
  readonly "pdf/pageImage": { readonly args: PdfPageImageArgs; readonly result: ImagePart };
}

const agent = protocolIdSchema("agent");
const documentId = z.string().regex(/^[a-z0-9]{8,64}$/u);
const page = z.int().min(1).max(100_000);

const pdfPageViewSchema: z.ZodType<PdfPageView> = z.object({
  page,
  text: z.string().max(maxPdfTextChars),
  image: z
    .object({ contentType: imageContentTypeSchema, bytes: imageByteCountSchema })
    .exactOptional(),
});

const readPdfResultSchema: z.ZodType<ReadPdfResult> = z.object({
  document: documentId,
  totalPages: z.int().min(0),
  pages: z
    .array(pdfPageViewSchema)
    .max(maxPdfPages)
    .readonly()
    .refine((pages) => pages.reduce((sum, each) => sum + each.text.length, 0) <= maxPdfTextChars, {
      message: "The pages hold more text than one answer carries.",
    }),
  textCut: z.boolean(),
  pagesCut: z.boolean(),
  imagesCut: z.boolean(),
});

/** The PDF operations, by name. */
export const pdfOperations: OperationTable<PdfOperationShapes> = {
  "pdf/read": {
    ...readFlags,
    name: "pdf/read",
    scope: "agent",
    args: z
      .strictObject({
        agent,
        url: z
          .string()
          .regex(/^https?:\/\//iu)
          .max(2_048)
          .exactOptional(),
        path: z.string().min(1).max(4_096).exactOptional(),
        pages: z.array(page).min(1).max(maxPdfPages).readonly().exactOptional(),
        password: z.string().min(1).max(maxPdfPasswordChars).exactOptional(),
      })
      .refine((args) => (args.url === undefined) !== (args.path === undefined), {
        message: "Name exactly one of url and path.",
      }),
    result: readPdfResultSchema,
  },
  "pdf/pageImage": {
    ...readFlags,
    name: "pdf/pageImage",
    scope: "agent",
    args: z.strictObject({
      agent,
      document: documentId,
      page,
      offset: imageByteCountSchema.exactOptional(),
    }),
    result: imagePartSchema,
  },
};
