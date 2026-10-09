import { z } from "zod";

/** What every answer of OKX's API carries: its code, `"0"` on success, and the data. */
export interface AnswerEnvelope {
  /** OKX's answer code, such as `"0"` or `"82000"`. */
  readonly code: string;
  readonly data: unknown;
}

/** Reads an answer's data into the venue's own type; data that breaks its schema is undefined. */
export type AnswerReader<T> = (data: unknown) => T | undefined;

const envelopeSchema: z.ZodType<AnswerEnvelope> = z.looseObject({
  code: z.string().regex(/^\d{1,9}$/),
  data: z.unknown(),
});

/** Reads an answer's envelope from its body; a body that is not one is undefined, never a throw. */
export function readEnvelope(body: string): AnswerEnvelope | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return undefined;
  }
  const envelope = envelopeSchema.safeParse(parsed);
  return envelope.success ? envelope.data : undefined;
}
