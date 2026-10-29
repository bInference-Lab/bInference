import { z } from "zod";

/** What the model evaluation reads from its environment; the key never reaches its output. */
export interface EvaluationEnv {
  /** The OpenAI-compatible endpoint's base URL, such as `https://api.openai.com/v1`. */
  readonly BINFERENCE_EVAL_BASE_URL?: string;
  /** The endpoint's key; none for an endpoint that takes none. */
  readonly BINFERENCE_EVAL_API_KEY?: string;
  /** The candidate models, comma separated, by their ids at the endpoint. */
  readonly BINFERENCE_EVAL_MODELS?: string;
}

/** Parses the evaluation's environment; every other variable is left out. */
export const evaluationEnvSchema: z.ZodType<EvaluationEnv> = z.object({
  BINFERENCE_EVAL_BASE_URL: z.url({ protocol: /^https?$/ }).exactOptional(),
  BINFERENCE_EVAL_API_KEY: z.string().min(1).exactOptional(),
  BINFERENCE_EVAL_MODELS: z.string().min(1).exactOptional(),
});
