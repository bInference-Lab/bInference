import * as z from "zod/mini";

/** What the smoke test reads of a `portfolio/get` answer to add its stakes and bridge to. */
export interface PortfolioAnswer {
  readonly balances: readonly { readonly wallet: string }[];
  readonly totalUsdMicros: string;
  readonly paperTotalUsdMicros?: string | undefined;
  readonly assets: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

/** What the smoke test answers instead of the engine: the engine's result, none when it failed. */
export type ReplyRewrite = (result: unknown) => object;

/** An engine's answer to a call: its id, and its result when it replied rather than failed. */
interface Answer {
  readonly id: string;
  readonly result?: unknown;
}

const callSchema = z.object({ t: z.literal("call"), id: z.string(), op: z.string() });
const answerSchema = z.object({
  t: z.enum(["reply", "fail"]),
  id: z.string(),
  result: z.optional(z.unknown()),
});
const portfolioSchema = z.looseObject({
  balances: z.array(z.looseObject({ wallet: z.string() })),
  totalUsdMicros: z.string(),
  paperTotalUsdMicros: z.optional(z.string()),
  assets: z.record(z.string(), z.unknown()),
});

function jsonOf(message: string): unknown {
  try {
    return JSON.parse(message);
  } catch {
    return undefined;
  }
}

/** The id of a `call` frame the page sent, with its operation; none for any other message. */
export function readCall(
  message: string,
): { readonly id: string; readonly op: string } | undefined {
  const call = callSchema.safeParse(jsonOf(message));
  return call.success ? call.data : undefined;
}

/** A `reply` or `fail` frame the engine sent; none for any other message. */
export function readAnswer(message: string): Answer | undefined {
  const answer = answerSchema.safeParse(jsonOf(message));
  return answer.success ? answer.data : undefined;
}

/** Reads a reply's result as a `portfolio/get` answer. */
export function readPortfolio(result: unknown): PortfolioAnswer {
  return portfolioSchema.parse(result);
}
