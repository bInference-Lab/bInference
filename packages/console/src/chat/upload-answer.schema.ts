import * as z from "zod/mini";

const uploadedSchema = z.object({ upload: z.string().check(z.minLength(1)) });
const refusedSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

/** What `POST /upload/:ticket` answered: the upload id, or the code of its refusal. */
export type UploadAnswer =
  | { readonly ok: true; readonly upload: string }
  | { readonly ok: false; readonly code: string };

/**
 * Reads the answer of `POST /upload/:ticket` (protocol spec, section 2.1): 201 `{ upload }`, or a
 * refusal `{ error: { code } }`. Any other answer reads as `unexpected`.
 */
export function readUploadAnswer(status: number, text: string): UploadAnswer {
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    body = undefined;
  }
  const uploaded = uploadedSchema.safeParse(body);
  if (status === 201 && uploaded.success) {
    return { ok: true, upload: uploaded.data.upload };
  }
  const refused = refusedSchema.safeParse(body);
  return { ok: false, code: refused.success ? refused.data.error.code : "unexpected" };
}
