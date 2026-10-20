import { z } from "zod";

// A raw CID: CIDv0 (`Qm` and 44 base58 characters) or CIDv1 in base32 (`b` and lowercase).
const cidSchema = z.string().regex(/^(Qm[1-9A-HJ-NP-Za-km-z]{44}|b[a-z2-7]{20,120})$/);

/** The upload mutation's answer, as Flap's docs give it: the metadata's CID. */
export interface UploadAnswer {
  readonly data: { readonly create: string };
}

/** Checks the upload mutation's answer. */
export const uploadAnswerSchema: z.ZodType<UploadAnswer> = z.object({
  data: z.object({ create: cidSchema }),
});

/** Where Flap's pin of a CID stands, as its pin status API names it. */
export type FlapPinState =
  | "queued"
  | "retrieving"
  | "processing"
  | "pinned"
  | "failed"
  | "not_found";

/** The pin status API's answer: the CID asked about and its pin's state. */
export interface PinAnswer {
  readonly data: { readonly cid: string; readonly status: FlapPinState };
}

/** Checks the pin status API's answer; a status Flap adds later reads as still under way. */
export const pinAnswerSchema: z.ZodType<PinAnswer> = z.object({
  data: z.object({
    cid: cidSchema,
    status: z
      .enum(["queued", "retrieving", "processing", "pinned", "failed", "not_found"])
      .catch("processing"),
  }),
});

const graphqlErrorsSchema = z.object({ errors: z.array(z.json()).min(1) });

/** An API answer's body as a schema reads it: the answer, GraphQL errors, or neither. */
export type JsonAnswer<T> =
  | { readonly kind: "answer"; readonly value: T }
  | { readonly kind: "errors" }
  | { readonly kind: "unreadable" };

/** Reads a JSON body: GraphQL errors first, then the schema's answer. */
export function readJsonAnswer<T>(body: string, schema: z.ZodType<T>): JsonAnswer<T> {
  const json = z
    .string()
    .transform((text, context): unknown => {
      try {
        return JSON.parse(text);
      } catch {
        context.addIssue({ code: "custom", message: "The body is no JSON." });
        return z.NEVER;
      }
    })
    .safeParse(body);
  if (!json.success) {
    return { kind: "unreadable" };
  }
  if (graphqlErrorsSchema.safeParse(json.data).success) {
    return { kind: "errors" };
  }
  const parsed = schema.safeParse(json.data);
  return parsed.success ? { kind: "answer", value: parsed.data } : { kind: "unreadable" };
}
