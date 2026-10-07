import { z } from "zod";
import { parseJsonText } from "./json-text.schema.js";

const errorAnswerSchema = z.looseObject({ code: z.int(), message: z.string() });

/** The error code of an answer KyberSwap's API gives instead of a result, such as 4008. */
export function readErrorCode(body: string): number | undefined {
  const answer = errorAnswerSchema.safeParse(parseJsonText(body));
  return answer.success ? answer.data.code : undefined;
}
