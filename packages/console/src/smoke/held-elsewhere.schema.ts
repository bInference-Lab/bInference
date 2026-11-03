import * as z from "zod/mini";

/** What the smoke test reads of a `portfolio/get` answer to add its stakes and bridge to. */
export interface PortfolioAnswer {
  readonly balances: readonly { readonly wallet: string }[];
  readonly totalUsdMicros: string;
  readonly paperTotalUsdMicros?: string | undefined;
  readonly assets: Readonly<Record<string, unknown>>;
  readonly [field: string]: unknown;
}

/** A reply frame, every field kept, with the id of the call it answers. */
interface Reply {
  readonly id: string;
  readonly result: unknown;
  readonly [field: string]: unknown;
}

const callSchema = z.object({ t: z.literal("call"), id: z.string(), op: z.string() });
const replySchema = z.looseObject({ t: z.literal("reply"), id: z.string(), result: z.unknown() });
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

/** A `reply` frame the engine sent; none for any other message. */
export function readReply(message: string): Reply | undefined {
  const reply = replySchema.safeParse(jsonOf(message));
  return reply.success ? reply.data : undefined;
}

/** Reads a reply's result as a `portfolio/get` answer. */
export function readPortfolio(result: unknown): PortfolioAnswer {
  return portfolioSchema.parse(result);
}
