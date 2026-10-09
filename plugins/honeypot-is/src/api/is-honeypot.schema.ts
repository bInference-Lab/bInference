import { z } from "zod";

/**
 * The fields of honeypot.is's IsHoneypot answer that the source reads. honeypot.is adds fields
 * without a new version, so every other field passes through unread.
 */
export interface HoneypotAnswer {
  /** The risk name, such as `low` or `honeypot`. */
  readonly risk: string;
  /**
   * The risk from 0 to 100, which honeypot.is's docs advise programs to read: 60 and above is
   * high, 90 and above a honeypot. Absent when the risk is unknown.
   */
  readonly riskLevel?: number;
  /** The summary's flags in lowercase, such as `high_fail_rate`. */
  readonly flags: readonly string[];
  /** Absent when honeypot.is could not decide. */
  readonly isHoneypot?: boolean;
  /** Its test trade's taxes in percent; absent when the simulation did not run. */
  readonly buyTax?: number;
  readonly sellTax?: number;
  /** Set when its simulation found a limit on how much one sale may sell. */
  readonly hasSellLimit: boolean;
  /** Absent when honeypot.is did not read the contract's code. */
  readonly isOpenSource?: boolean;
  readonly isProxy?: boolean;
  /** The USD value of the pair it tested, as a JSON number. */
  readonly liquidityUsd?: number;
}

const summarySchema = z
  .looseObject({
    risk: z.string(),
    riskLevel: z.number().optional(),
    flags: z.array(z.looseObject({ flag: z.string() })).optional(),
  })
  .transform(({ risk, riskLevel, flags }) => ({
    risk,
    ...(riskLevel === undefined ? {} : { riskLevel }),
    flags: (flags ?? []).map((item) => item.flag.toLowerCase()),
  }));

const simulationSchema = z
  .looseObject({
    buyTax: z.number().optional(),
    sellTax: z.number().optional(),
    maxSell: z.looseObject({ tokenWei: z.string() }).optional(),
  })
  .transform(({ buyTax, sellTax, maxSell }) => ({
    ...(buyTax === undefined ? {} : { buyTax }),
    ...(sellTax === undefined ? {} : { sellTax }),
    hasSellLimit: maxSell !== undefined,
  }));

const codeSchema = z
  .looseObject({ openSource: z.boolean(), isProxy: z.boolean() })
  .transform(({ openSource, isProxy }) => ({ isOpenSource: openSource, isProxy }));

const answerSchema: z.ZodType<HoneypotAnswer> = z
  .looseObject({
    summary: summarySchema,
    honeypotResult: z.looseObject({ isHoneypot: z.boolean() }).optional(),
    simulationResult: simulationSchema.optional(),
    contractCode: codeSchema.optional(),
    pair: z.looseObject({ liquidity: z.number().nonnegative() }).optional(),
  })
  .transform(({ summary, honeypotResult, simulationResult, contractCode, pair }) => ({
    ...summary,
    ...(honeypotResult === undefined ? {} : { isHoneypot: honeypotResult.isHoneypot }),
    ...(simulationResult ?? { hasSellLimit: false }),
    ...contractCode,
    ...(pair === undefined ? {} : { liquidityUsd: pair.liquidity }),
  }));

/** Parses JSON text from honeypot.is; text that is no JSON or breaks the schema is undefined. */
export function readHoneypotAnswer(body: string): HoneypotAnswer | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const answer = answerSchema.safeParse(json);
  return answer.success ? answer.data : undefined;
}
