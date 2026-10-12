import { isJsonNumber, parseJsonText } from "@binference/plugin-sdk/data";
import { z } from "zod";

/** One row of an OHLCV list, each figure kept as the text GeckoTerminal wrote. */
export interface GeckoCandleRow {
  /** When the candle starts, in seconds since the epoch. */
  readonly timestamp: string;
  readonly open: string;
  readonly high: string;
  readonly low: string;
  readonly close: string;
  readonly volume: string;
}

/** The answer of the OHLCV endpoint: its rows, and the token the prices are of when it says. */
export interface GeckoOhlcv {
  readonly rows: readonly GeckoCandleRow[];
  /** The address of the token the candles price, from `meta.base`, when the answer has one. */
  readonly baseAddress: string | undefined;
}

const decimalText = z.string().refine(isJsonNumber);
// `[timestamp, open, high, low, close, volume]`, as the docs list each element.
const rowSchema = z.tuple([
  decimalText,
  decimalText,
  decimalText,
  decimalText,
  decimalText,
  decimalText,
]);

const ohlcvSchema = z.object({
  data: z.object({ attributes: z.object({ ohlcv_list: z.array(rowSchema) }) }),
  meta: z.object({ base: z.object({ address: z.string().min(1) }).nullish() }).nullish(),
});

/**
 * Reads the answer of `GET /networks/{network}/pools/{pool_address}/ohlcv/{timeframe}`: its rows
 * in GeckoTerminal's order, newest first. An answer outside the documented `ohlcv` schema is
 * undefined.
 */
export function readOhlcv(text: string): GeckoOhlcv | undefined {
  const answer = ohlcvSchema.safeParse(parseJsonText(text));
  if (!answer.success) {
    return undefined;
  }
  const rows = answer.data.data.attributes.ohlcv_list.map(
    ([timestamp, open, high, low, close, volume]) => ({
      timestamp,
      open,
      high,
      low,
      close,
      volume,
    }),
  );
  return { rows, baseAddress: answer.data.meta?.base?.address ?? undefined };
}
