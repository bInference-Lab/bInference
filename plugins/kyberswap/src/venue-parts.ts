import type { ChainRef } from "@binference/plugin-sdk";
import type { KyberswapApi } from "./api/kyberswap-api.js";
import type { ChainSetup } from "./chain-setup.js";

/** What the venue's quote and build share: the API client and the chains it trades on. */
export interface VenueParts {
  readonly api: KyberswapApi;
  readonly setups: ReadonlyMap<ChainRef, ChainSetup>;
}
