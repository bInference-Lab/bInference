import { z } from "zod";
import { type JsonValue, jsonParamsSchema } from "./json-value.schema.js";

/** A request as viem hands it to a custom transport. */
export interface ViemRequest {
  readonly method: string;
  readonly params: readonly JsonValue[];
}

/** Checks a request from viem before it goes out: a method name and plain JSON params. */
export const viemRequestSchema: z.ZodType<ViemRequest> = z.object({
  method: z.string().min(1),
  params: jsonParamsSchema.optional().transform((params) => params ?? []),
});
