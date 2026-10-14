import {
  type AccountRef,
  accountRefSchema,
  type AssetRef,
  assetRefParts,
  assetRefSchema,
  type PriceMiss,
  type PriceRead,
  type ReadAnswer,
  type ReadCall,
} from "@binference/chain";
import { err, ok, type Ratio, type Result } from "@binference/core";
import { z } from "zod";
import { callVenue, type VenueCallOptions } from "./call-venue.js";
import type { HostedVenue } from "./hosted-venue.js";
import { contractsWithLaunch, type LaunchContracts } from "./launch-contracts.js";
import { isLaunchpad, readCurves } from "./read-curves.js";

/** A venue's price read as the host hands it on: checked, copied, with the venue that declared it. */
export interface HostedPriceRead extends PriceRead {
  /** The venue whose reads price the token. */
  readonly venue: string;
}

// Each watched token's calls ride in one batched read per block, so a venue gets a few, each small.
const maxCallsPerToken = 4;
const maxInputChars = 4_096;

interface ReadParts {
  readonly quoteAsset: AssetRef;
  readonly calls: readonly ReadCall[];
}

/** {@link ReadParts} as a venue's answer carries them: CAIP ids as text. */
interface ReadPartsWire {
  readonly quoteAsset: string;
  readonly calls: readonly { readonly target: string; readonly input: string }[];
}

const readPartsSchema: z.ZodType<ReadParts, ReadPartsWire> = z.object({
  quoteAsset: assetRefSchema,
  calls: z
    .array(
      z.object({
        target: accountRefSchema,
        input: z.string().min(1).max(maxInputChars),
      }),
    )
    .min(1)
    .max(maxCallsPerToken),
});

const unpriced = err("unpriced");

function isPriced(price: Ratio): boolean {
  return (
    typeof price.numerator === "bigint" &&
    typeof price.denominator === "bigint" &&
    price.numerator > 0n &&
    price.denominator > 0n
  );
}

// The venue's own pricing step, run so that it can neither throw nor answer a price at or below 0.
function guardedPrice(
  read: PriceRead,
): (answers: readonly ReadAnswer[]) => Result<Ratio, PriceMiss> {
  return (answers) => {
    try {
      const price = read.price(Object.freeze([...answers]));
      if (!price.ok) {
        return price.error === "replan" ? err("replan") : unpriced;
      }
      return isPriced(price.value)
        ? ok(
            Object.freeze({
              numerator: price.value.numerator,
              denominator: price.value.denominator,
            }),
          )
        : unpriced;
    } catch {
      return unpriced;
    }
  };
}

// A read the host trusts: of its types, at most four calls, each to a contract the venue declares
// on the token's chain, quoted in another asset of that chain.
function hostedReadOf(
  venue: { readonly id: string; readonly declared: readonly AccountRef[] },
  token: AssetRef,
  read: PriceRead,
): HostedPriceRead | undefined {
  const parts = readPartsSchema.safeParse({ quoteAsset: read.quoteAsset, calls: read.calls });
  if (!parts.success || typeof read.price !== "function") {
    return undefined;
  }
  const { quoteAsset, calls } = parts.data;
  const isSameChain = assetRefParts(quoteAsset).chain === assetRefParts(token).chain;
  if (
    !isSameChain ||
    quoteAsset === token ||
    !calls.every(({ target }) => venue.declared.includes(target))
  ) {
    return undefined;
  }
  return Object.freeze({
    venue: venue.id,
    quoteAsset,
    calls: Object.freeze(calls.map((call) => Object.freeze({ ...call }))),
    price: guardedPrice(read),
  });
}

const priceAnswerSchema = z.discriminatedUnion("ok", [
  z.object({
    ok: z.literal(true),
    value: z.custom<PriceRead>((value) => typeof value === "object" && value !== null),
  }),
  z.object({ ok: z.literal(false), error: z.literal("no_price_read") }),
]);

/** A venue to ask for a token's price read, with the contracts of the token's launch on it. */
interface Candidate {
  readonly hosted: HostedVenue;
  readonly launch?: LaunchContracts;
}

// The venue's registry contracts on the token's chain, with the launch's when it holds the token.
function contractsOf(candidate: Candidate, token: AssetRef) {
  const { hosted, launch } = candidate;
  const { chain } = assetRefParts(token);
  const registry = hosted.contracts.get(chain);
  return registry === undefined
    ? undefined
    : contractsWithLaunch(registry, launch, hosted.launchNames.get(chain));
}

async function askVenue(
  candidate: Candidate,
  token: AssetRef,
  call: VenueCallOptions,
): Promise<Result<HostedPriceRead, "no_price_read" | "venue_down">> {
  const { venue } = candidate.hosted;
  const contracts = contractsOf(candidate, token);
  if (venue.priceRead === undefined || contracts === undefined) {
    return err("no_price_read");
  }
  const asked = Object.freeze({ token, contracts });
  const answer = await callVenue(async (signal) => {
    const read = await venue.priceRead?.(asked, { signal });
    return read ?? err("no_price_read");
  }, call);
  const parsed = answer.ok ? priceAnswerSchema.safeParse(answer.value) : undefined;
  if (parsed?.success !== true) {
    return err("venue_down");
  }
  if (!parsed.data.ok) {
    return err("no_price_read");
  }
  const declared = Object.values(contracts);
  const hostedRead = hostedReadOf({ id: venue.id, declared }, token, parsed.data.value);
  return hostedRead === undefined ? err("venue_down") : ok(hostedRead);
}

/** The venues still to ask, and why the ones asked so far priced nothing. */
interface PriceAsk {
  readonly candidates: readonly Candidate[];
  readonly failure: "no_price_read" | "venue_down";
}

// Asks each venue in turn, in the host's order, until one prices the token. A venue that failed
// makes the answer `venue_down` when no later one priced it, so the watcher asks again later.
async function firstPriced(
  ask: PriceAsk,
  token: AssetRef,
  call: VenueCallOptions,
): Promise<Result<HostedPriceRead, "no_price_read" | "venue_down">> {
  const [candidate, ...candidates] = ask.candidates;
  if (candidate === undefined) {
    return err(ask.failure);
  }
  const read = await askVenue(candidate, token, call);
  if (read.ok) {
    return read;
  }
  const failure = read.error === "venue_down" ? "venue_down" : ask.failure;
  return firstPriced({ candidates, failure }, token, call);
}

/**
 * Asks the venues how to price a token each block (ARCHITECTURE.md section 9). A token a
 * launchpad holds on its curve is priced by that launchpad alone, since its curve sets its price;
 * any other token by the first other venue, in the host's order, that declares a read for it. The
 * host copies each read: at most four calls, each to a contract the venue declares on the token's
 * chain or to one of the token's launch on the launchpad that holds it (decision 0212), quoted in
 * another asset of that chain, and a pricing step that can neither throw nor give
 * a price at or below zero. A token
 * no venue prices is `no_price_read`; a venue that throws, times out or answers outside its types,
 * when no other venue priced the token, is `venue_down`. Rejects with the signal's reason once it
 * aborts.
 */
export async function readPrices(
  token: AssetRef,
  venues: ReadonlyMap<string, HostedVenue>,
  call: VenueCallOptions,
): Promise<Result<HostedPriceRead, "no_price_read" | "venue_down">> {
  const curves = await readCurves(token, venues, call);
  if (!curves.ok) {
    return curves;
  }
  const holders = curves.value.flatMap(({ launchpad, launch }): Candidate[] => {
    const hosted = venues.get(launchpad);
    return hosted === undefined ? [] : [launch === undefined ? { hosted } : { hosted, launch }];
  });
  if (holders.length > 0) {
    const read = await firstPriced({ candidates: holders, failure: "no_price_read" }, token, call);
    // A curve token's price is its curve's: a launchpad that holds it and cannot price it is down.
    return read.ok ? read : err("venue_down");
  }
  const pools = [...venues.values()]
    .filter(({ venue }) => !isLaunchpad(venue))
    .map((hosted): Candidate => ({ hosted }));
  return firstPriced({ candidates: pools, failure: "no_price_read" }, token, call);
}
