import type { ChainRef } from "@binference/plugin-sdk";
import type { OkxApi } from "./api/okx-api.js";
import type { ChainSetup } from "./chain-setup.js";

/** What the venue's quote and build share: the API client and the chains it trades on. */
export interface VenueParts {
  readonly api: OkxApi;
  readonly setups: ReadonlyMap<ChainRef, ChainSetup>;
}
