import { z } from "zod";

/** One liquidity protocol OKX routes through on a chain: its DEX id and its name. */
export interface LiquiditySource {
  /** OKX's DEX id, such as `"34"`, which `excludeDexIds` takes. */
  readonly id: string;
  /** Its name, such as `Uniswap V2`, as routes name it. */
  readonly name: string;
}

const sourceSchema: z.ZodType<LiquiditySource> = z
  .looseObject({ id: z.string().regex(/^\d{1,9}$/), name: z.string().min(1) })
  .transform(({ id, name }) => ({ id, name }));

/** Reads a successful `/get-liquidity` answer's data; anything else is undefined. */
export function readLiquidityData(data: unknown): readonly LiquiditySource[] | undefined {
  const sources = z.array(sourceSchema).safeParse(data);
  return sources.success ? sources.data : undefined;
}
