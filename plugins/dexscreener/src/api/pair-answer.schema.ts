import { isJsonNumber, parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/** A number of an answer, kept as the text DEX Screener wrote. */
const decimalText = z.string().refine(isJsonNumber);
// Figures DEX Screener may leave out or send as null.
const figure = decimalText.nullish();

/**
 * One pair of DEX Screener's `Pair` schema, with the fields the source reads. A field DEX Screener
 * sent as null or not at all is undefined.
 */
export interface DexPair {
  readonly chainId: string;
  readonly dexId: string;
  readonly pairAddress: string;
  readonly baseAddress: string;
  /** DEX Screener's schema lets a pair's quote token have no address. */
  readonly quoteAddress: string | undefined;
  readonly priceUsd: string | undefined;
  readonly liquidityUsd: string | undefined;
  readonly volume24hUsd: string | undefined;
  readonly change24hPercent: string | undefined;
  readonly createdAtMs: string | undefined;
}

const pairSchema = z.object({
  chainId: z.string().min(1),
  dexId: z.string().min(1),
  pairAddress: z.string().min(1),
  baseToken: z.object({ address: z.string().min(1) }),
  quoteToken: z.object({ address: z.string().min(1).nullish() }),
  priceUsd: figure,
  liquidity: z.object({ usd: figure }).nullish(),
  volume: z.record(z.string(), decimalText).nullish(),
  priceChange: z.record(z.string(), decimalText).nullish(),
  pairCreatedAt: figure,
});

type PairWire = z.infer<typeof pairSchema>;

function pairOf(wire: PairWire): DexPair {
  return {
    chainId: wire.chainId,
    dexId: wire.dexId,
    pairAddress: wire.pairAddress,
    baseAddress: wire.baseToken.address,
    quoteAddress: wire.quoteToken.address ?? undefined,
    priceUsd: wire.priceUsd ?? undefined,
    liquidityUsd: wire.liquidity?.usd ?? undefined,
    volume24hUsd: wire.volume?.["h24"],
    change24hPercent: wire.priceChange?.["h24"],
    createdAtMs: wire.pairCreatedAt ?? undefined,
  };
}

const pairListSchema = z.array(pairSchema);

/**
 * Reads the answer of `GET /token-pairs/v1/{chainId}/{tokenAddress}` or
 * `GET /tokens/v1/{chainId}/{tokenAddresses}`: a list of pairs. An answer outside DEX Screener's
 * `Pair` schema is undefined.
 */
export function readPairList(text: string): readonly DexPair[] | undefined {
  const answer = pairListSchema.safeParse(parseJsonText(text));
  return answer.success ? answer.data.map(pairOf) : undefined;
}
