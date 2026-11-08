import type { PdfContent, PdfRefusal } from "@binference/engine/pdf";
import { fileLimits } from "@binference/protocol";
import { z } from "zod";

/** What the reader hands its worker thread: the PDF's bytes, the pages and the password. */
export interface PdfJob {
  readonly bytes: Uint8Array;
  readonly pages?: readonly number[];
  readonly password?: string;
}

/** What the worker thread answers: what it read, why it could not, or that it failed. */
export type PdfJobAnswer =
  | { readonly kind: "read"; readonly content: PdfContent }
  | { readonly kind: "refused"; readonly refusal: PdfRefusal }
  | { readonly kind: "failed" };

const bytes = z.instanceof(Uint8Array);

const pdfJobSchema: z.ZodType<PdfJob> = z.strictObject({
  bytes,
  pages: z.array(z.int().min(1)).max(fileLimits.maxPdfPages).readonly().exactOptional(),
  password: z.string().max(fileLimits.maxPdfPasswordChars).exactOptional(),
});

const contentSchema: z.ZodType<PdfContent> = z.object({
  totalPages: z.int().min(0),
  pages: z
    .array(
      z.object({
        page: z.int().min(1),
        text: z.string().max(fileLimits.maxPdfTextChars),
        picture: bytes.exactOptional(),
      }),
    )
    .max(fileLimits.maxPdfPages)
    .readonly(),
  textCut: z.boolean(),
  pagesCut: z.boolean(),
  imagesCut: z.boolean(),
});

const pdfJobAnswerSchema: z.ZodType<PdfJobAnswer> = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("read"), content: contentSchema }),
  z.object({
    kind: z.literal("refused"),
    refusal: z.enum(["not_pdf", "password", "no_pages", "unreadable", "timed_out"]),
  }),
  z.object({ kind: z.literal("failed") }),
]);

/** A job as the worker thread receives it, or `undefined` for anything else. */
export function pdfJobOf(value: unknown): PdfJob | undefined {
  const job = pdfJobSchema.safeParse(value);
  return job.success ? job.data : undefined;
}

/** An answer as the reader receives it from its worker thread; anything else is `failed`. */
export function pdfJobAnswerOf(value: unknown): PdfJobAnswer {
  const answer = pdfJobAnswerSchema.safeParse(value);
  return answer.success ? answer.data : { kind: "failed" };
}
