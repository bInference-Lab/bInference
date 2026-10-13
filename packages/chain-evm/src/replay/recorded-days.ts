import day20261012 from "./days/2026-10-12.json" with { type: "json" };
import type { PricePath } from "./price-path.js";
import { readPricePath } from "./price-path.schema.js";

/**
 * 2026-10-12 (UTC) on BSC: BTCB, ETH and Cake against WBNB on their PancakeSwap v2 pairs, recorded
 * from 48 Club's public node by `pnpm replay:record` (decision 0209).
 */
export const recordedDay: PricePath = readPricePath(day20261012);
