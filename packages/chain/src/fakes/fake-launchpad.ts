import { BinferenceError, err, ok, type Ratio, type Result } from "@binference/core";
import type { AccountRef } from "../caip/account-ref.js";
import { type AssetRef, assetRefSchema } from "../caip/asset-ref.js";
import type { CurveHolding } from "../venues/curve-holding.js";
import type { InsiderReader, PriceReader } from "../venues/ports.js";
import type { PriceRead, ReadAnswer } from "../venues/price-read.js";
import type { LaunchpadVenue, Venue, VenueContracts } from "../venues/venue.js";
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
  /**
   * The curve each held token's launch has of its own, as one launch contract `curve` that its
   * curve read names: it then trades and prices through that curve, never its `router`. When
   * absent, it declares no launch contract.
   */
  readonly launchCurve?: AccountRef;
  /** The wallets its contracts favor on each token it holds; none when absent. */
  readonly insiders?: readonly AccountRef[];
}

/** A fake launchpad, whose tokens can graduate during a test. */
export interface FakeLaunchpad
  extends Omit<LaunchpadVenue, "priceRead" | "insiders">, PriceReader, InsiderReader {
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

// The launch's curve the host gave with a request; a request without one cannot be built.
function curveOf(contracts: Readonly<Record<string, AccountRef>>): AccountRef {
  const curve = contracts["curve"];
  if (curve === undefined) {
    throw new BinferenceError({
      code: "venue.no_contract",
      message: "The fake launchpad builds a held token's trade only through its launch's curve.",
    });
  }
  return curve;
}

/** What a fake launchpad holds: its tokens on the curve, their quote asset and launch curve. */
interface FakeCurve {
  readonly held: Set<AssetRef>;
  readonly quoteAsset: AssetRef;
  readonly launchCurve: AccountRef | undefined;
}

function holdingOf(curve: FakeCurve, token: AssetRef): CurveHolding {
  const { quoteAsset, launchCurve } = curve;
  if (!curve.held.has(token)) {
    return { onCurve: false };
  }
  return launchCurve === undefined
    ? { onCurve: true, quoteAsset }
    : { onCurve: true, quoteAsset, launch: { curve: launchCurve } };
}

// One read of the router, or of the launch's curve when the launchpad has one.
function priceReadOf(
  curve: FakeCurve,
  request: Parameters<PriceReader["priceRead"]>[0],
): Result<PriceRead, "no_price_read"> {
  const target = request.contracts[curve.launchCurve === undefined ? "router" : "curve"];
  if (!curve.held.has(request.token) || target === undefined) {
    return err("no_price_read");
  }
  const calls = [{ target, input: `price:${request.token}` }];
  return ok({ quoteAsset: curve.quoteAsset, calls, price: fakePriceOf });
}

// The fake venue's declaration and build, through the launch's curve when the launchpad has one.
function launchPartsOf(
  venue: Venue,
  launchCurve: AccountRef | undefined,
): Pick<Venue, "contracts" | "build"> {
  if (launchCurve === undefined) {
    return {
      contracts: venue.contracts,
      build: async (request, call) => venue.build(request, call),
    };
  }
  return {
    contracts: venue.contracts.map((item): VenueContracts => ({
      ...item,
      launchContracts: ["curve"],
    })),
    build: async (request, call) =>
      venue.build({ ...request, contracts: { router: curveOf(request.contracts) } }, call),
  };
}

/**
 * Creates a launchpad of the fake chain, for tests. It holds its tokens on its curve until they
 * graduate, quotes and builds only trades between such a token and its quote asset, through its
 * `router` as the fake venue does, and answers any other pair as `no_route`. It prices a token on
 * its curve with one read of its `router`, which {@link fakePriceAnswer} answers. With a
 * `launchCurve`, each held token's launch has that curve, which its curve read names and which
 * its trades and price reads use in place of the `router`. It names its `insiders` for each token
 * it holds.
 */
export function createFakeLaunchpad(options: FakeLaunchpadOptions): FakeLaunchpad {
  const venue = createFakeVenue({
    ...(options.rate === undefined ? {} : { rate: options.rate }),
    ...(options.noDeadline === undefined ? {} : { noDeadline: options.noDeadline }),
  });
  const curve: FakeCurve = {
    held: new Set(options.onCurve),
    quoteAsset: options.quoteAsset ?? fakeCoin,
    launchCurve: options.launchCurve,
  };
  const isCurvePair = (assets: readonly AssetRef[]): boolean =>
    assets.includes(curve.quoteAsset) && assets.some((asset) => curve.held.has(asset));
  return {
    ...venue,
    ...launchPartsOf(venue, options.launchCurve),
    id: options.id ?? "fake-curve",
    async quote(request, call) {
      call.signal.throwIfAborted();
      return isCurvePair([request.amountIn.asset, request.assetOut])
        ? venue.quote(request, call)
        : err("no_route");
    },
    async curve(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(holdingOf(curve, request.token));
    },
    async priceRead(request, { signal }) {
      signal.throwIfAborted();
      return await Promise.resolve(priceReadOf(curve, request));
    },
    async insiders(request, { signal }) {
      signal.throwIfAborted();
      const named = curve.held.has(request.token) ? (options.insiders ?? []) : [];
      return await Promise.resolve(named);
    },
    graduate(token) {
      curve.held.delete(token);
    },
  };
}
