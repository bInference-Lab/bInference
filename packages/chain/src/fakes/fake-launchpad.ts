import { err, ok, type Ratio, type Result } from "@binference/core";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { PriceReader } from "../venues/ports.js";
import type { PriceRead, ReadAnswer } from "../venues/price-read.js";
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
  /** Its trade calls carry no deadline, as a curve's may not; when absent, each carries one. */
  readonly noDeadline?: boolean;
}

/** A fake launchpad, whose tokens can graduate during a test. */
export interface FakeLaunchpad extends Omit<LaunchpadVenue, "priceRead">, PriceReader {
  /** Moves a token off the curve, as its graduation to the pools does. */
  graduate(token: AssetRef): void;
}

const fakeCoin = assetRefSchema.parse("fake:1/slip44:1");
const fakePricePattern = /^price:([1-9]\d*)\/([1-9]\d*)$/;

/**
 * What a fake launchpad's price read answers at a block for a curve price, in base units of the
 * quote asset for one base unit of the token: `price:<numerator>/<denominator>`.
 */
export function fakePriceAnswer(price: Ratio): string {
  return `price:${price.numerator.toString()}/${price.denominator.toString()}`;
}

// One answer in the fake's own shape, both sides above zero; anything else prices nothing.
function fakePriceOf(answers: readonly ReadAnswer[]): Result<Ratio, "unpriced"> {
  const [answer, ...rest] = answers;
  const found = answer === undefined || rest.length > 0 ? null : fakePricePattern.exec(answer);
  const [, numerator, denominator] = found ?? [];
  return numerator === undefined || denominator === undefined
    ? err("unpriced")
    : ok({ numerator: BigInt(numerator), denominator: BigInt(denominator) });
}

/**
 * Creates a launchpad of the fake chain, for tests. It holds its tokens on its curve until they
 * graduate, quotes and builds only trades between such a token and its quote asset, through its
 * `router` as the fake venue does, and answers any other pair as `no_route`. It prices a token on
 * its curve with one read of its `router`, which {@link fakePriceAnswer} answers.
 */
export function createFakeLaunchpad(options: FakeLaunchpadOptions): FakeLaunchpad {
  const venue = createFakeVenue({
    ...(options.rate === undefined ? {} : { rate: options.rate }),
    ...(options.noDeadline === undefined ? {} : { noDeadline: options.noDeadline }),
  });
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
    async priceRead(request, { signal }) {
      signal.throwIfAborted();
      const router = request.contracts["router"];
      if (!held.has(request.token) || router === undefined) {
        return await Promise.resolve(err("no_price_read"));
      }
      const read: PriceRead = {
        quoteAsset,
        calls: [{ target: router, input: `price:${request.token}` }],
        price: fakePriceOf,
      };
      return ok(read);
    },
    graduate(token) {
      held.delete(token);
    },
  };
}
