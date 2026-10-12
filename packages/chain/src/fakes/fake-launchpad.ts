import { err, type Ratio } from "@binference/core";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { LaunchpadVenue } from "../venues/venue.js";
import { createFakeVenue } from "./fake-venue.js";

/** What a fake launchpad holds on its curve, and what it trades those tokens against. */
export interface FakeLaunchpadOptions {
  /** The launchpad's id; `fake-curve` when absent. The registry must list its `router`. */
  readonly id?: string;
  /** The tokens on its curve when it starts. */
  readonly onCurve: readonly AssetRef[];
  /** What its curve trades each token against; the fake chain's coin when absent. */
  readonly quoteAsset?: AssetRef;
  /** Base units out per base unit in, either way; 2 to 1 when absent. */
  readonly rate?: Ratio;
}

/** A fake launchpad, whose tokens can graduate during a test. */
export interface FakeLaunchpad extends LaunchpadVenue {
  /** Moves a token off the curve, as its graduation to the pools does. */
  graduate(token: AssetRef): void;
}

const fakeCoin = assetRefSchema.parse("fake:1/slip44:1");

/**
 * Creates a launchpad of the fake chain, for tests. It holds its tokens on its curve until they
 * graduate, quotes and builds only trades between such a token and its quote asset, through its
 * `router` as the fake venue does, and answers any other pair as `no_route`.
 */
export function createFakeLaunchpad(options: FakeLaunchpadOptions): FakeLaunchpad {
  const venue = createFakeVenue(options.rate === undefined ? {} : { rate: options.rate });
  const held = new Set(options.onCurve);
  const quoteAsset = options.quoteAsset ?? fakeCoin;
  const isCurvePair = (assets: readonly AssetRef[]): boolean =>
    assets.includes(quoteAsset) && assets.some((asset) => held.has(asset));
  return {
    ...venue,
    id: options.id ?? "fake-curve",
    async quote(request, call) {
      call.signal.throwIfAborted();
      return isCurvePair([request.amountIn.asset, request.assetOut])
        ? venue.quote(request, call)
        : err("no_route");
    },
    async curve(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(
        held.has(request.token) ? { onCurve: true, quoteAsset } : { onCurve: false },
      );
    },
    graduate(token) {
      held.delete(token);
    },
  };
}
