import { isJsonNumber, parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/**
 * One pool of GeckoTerminal's `pool` schema, with the fields the source reads. A figure
 * GeckoTerminal sent as null or not at all is undefined.
 */
export interface GeckoPool {
  /** The pool's address or id on its network, as GeckoTerminal wrote it. */
  readonly address: string;
  /** The id of the pool's exchange, such as `pancakeswap_v2`. */
  readonly dexId: string;
  /** The base token's id, `<network>_<address>`. */
  readonly baseTokenId: string;
  /** The quote token's id, `<network>_<address>`. */
  readonly quoteTokenId: string;
  readonly basePriceUsd: string | undefined;
  readonly reserveUsd: string | undefined;
  readonly volume24hUsd: string | undefined;
  /** When the pool was created, as an ISO 8601 time. */
  readonly createdAt: string | undefined;
}

/** A number of an answer, kept as the text GeckoTerminal wrote; it writes figures as strings. */
const decimalText = z.string().refine(isJsonNumber);
const figure = decimalText.nullish();
const relation = z.object({ data: z.object({ id: z.string().min(1) }) });
// The figures GeckoTerminal keys by period, such as `h24`; a period it lacks is undefined.
const byPeriod = z.record(z.string(), decimalText.nullable()).nullish();

const poolSchema = z.object({
  type: z.literal("pool"),
  attributes: z.object({
    address: z.string().min(1),
    base_token_price_usd: figure,
    reserve_in_usd: figure,
    volume_usd: byPeriod,
    pool_created_at: z.string().nullish(),
  }),
  relationships: z.object({ base_token: relation, quote_token: relation, dex: relation }),
});

type PoolWire = z.infer<typeof poolSchema>;

function poolOf({ attributes, relationships }: PoolWire): GeckoPool {
  return {
    address: attributes.address,
    dexId: relationships.dex.data.id,
    baseTokenId: relationships.base_token.data.id,
    quoteTokenId: relationships.quote_token.data.id,
    basePriceUsd: attributes.base_token_price_usd ?? undefined,
    reserveUsd: attributes.reserve_in_usd ?? undefined,
    volume24hUsd: attributes.volume_usd?.["h24"] ?? undefined,
    createdAt: attributes.pool_created_at ?? undefined,
  };
}

const poolListSchema = z.object({ data: z.array(poolSchema) });

/**
 * Reads the answer of `GET /networks/{network}/tokens/{token_address}/pools` or
 * `GET /networks/{network}/trending_pools`: a list of pools, in GeckoTerminal's order. An answer
 * outside its documented `pool` schema is undefined.
 */
export function readPoolList(text: string): readonly GeckoPool[] | undefined {
  const answer = poolListSchema.safeParse(parseJsonText(text));
  return answer.success ? answer.data.data.map(poolOf) : undefined;
}
