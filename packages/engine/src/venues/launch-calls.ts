import {
  type AccountRef,
  type Amount,
  type AssetRef,
  assetRefSchema,
  type DecodedLaunch,
  type Launcher,
  type LaunchPin,
  type LaunchPinRequest,
  launchPinSchema,
  type LaunchQuote,
  launchQuoteSchema,
  type LaunchTerms,
  type RegisteredChain,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import type { BuildMismatch } from "./build-checks.js";
import { callVenue, ownCopy, type VenueCallOptions } from "./call-venue.js";
import { nativeAssetOf } from "./host-terms.js";
import {
  checkLaunchSteps,
  type LaunchBounds,
  type LaunchStep,
  readLaunchSteps,
} from "./launch-checks.js";
import type { LaunchSetting } from "./launch-settings.schema.js";
import type { VenueFailure } from "./venue-host.js";

/** A launch the host quotes, pins and builds on one launchpad, from the agent's launch wallet. */
export interface HostedLaunch {
  readonly venue: string;
  readonly wallet: AccountRef;
  readonly name: string;
  readonly symbol: string;
  readonly pair: AssetRef;
  readonly firstBuy?: Amount;
  readonly settings: readonly LaunchSetting[];
}

/** The words and picture a launchpad uploads and pins for a launch. */
export type LaunchWords = Pick<LaunchPinRequest, "description" | "links" | "image">;

/** What a launch is built from once its quote and its upload are in hand. */
export interface LaunchUpload {
  readonly quote: LaunchQuote;
  readonly metadataUri: string;
  /** The least of the new token the first buy may accept; with a first buy alone. */
  readonly minOutBase?: bigint;
}

/** A launch's steps, every one checked, and the launch its create call makes. */
export interface LaunchPlan {
  readonly steps: readonly LaunchStep[];
  readonly launch: DecodedLaunch;
  /** The create call's first buy carries no minimum, as its launcher declares (decision 0270). */
  readonly isFirstBuyUnbound?: true;
}

/** The host's refusal of a launch's build; `mismatch` names the failed check. */
export interface LaunchRefused {
  readonly ok: false;
  readonly error: VenueFailure;
  readonly mismatch?: BuildMismatch;
}

/** A launch on its launchpad and chain, with the terms the launchpad is asked under. */
export interface LaunchContext {
  readonly launcher: Launcher;
  readonly chain: RegisteredChain;
  readonly terms: LaunchTerms;
}

const quoteAnswerSchema = z.discriminatedUnion("ok", [
  z.strictObject({ ok: z.literal(true), value: launchQuoteSchema }),
  z.strictObject({ ok: z.literal(false), error: z.literal("no_route") }),
]);

// The fee is in the chain's coin, and a first buy, and only one, gets some of the new token.
function isQuoteShaped(quote: LaunchQuote, context: LaunchContext): boolean {
  const { firstBuyOut } = quote;
  const hasBuy = context.terms.firstBuy !== undefined;
  return (
    quote.fee.asset === nativeAssetOf(context.chain) &&
    quote.fee.base >= 0n &&
    (hasBuy ? firstBuyOut !== undefined && firstBuyOut > 0n : firstBuyOut === undefined)
  );
}

/** Asks a launch's launchpad for its quote, and checks its shape. */
export async function quoteLaunch(
  context: LaunchContext,
  call: VenueCallOptions,
): Promise<Result<LaunchQuote, VenueFailure>> {
  const { launcher, terms } = context;
  const answer = await callVenue(async (signal) => launcher.quoteLaunch(terms, { signal }), call);
  const quote = answer.ok ? ownCopy(quoteAnswerSchema, answer.value) : undefined;
  if (quote === undefined) {
    return err("venue_down");
  }
  if (!quote.ok) {
    return quote;
  }
  return isQuoteShaped(quote.value, context) ? ok(quote.value) : err("decode_mismatch");
}

/**
 * Asks a launch's launchpad to upload and pin its words and picture. The launchpad gets its own
 * copy of the picture's bytes, so nothing it writes there changes the caller's.
 */
export async function pinLaunch(
  context: LaunchContext,
  words: LaunchWords,
  call: VenueCallOptions,
): Promise<Result<LaunchPin, "venue_down">> {
  const image = Object.freeze({ ...words.image, bytes: Uint8Array.from(words.image.bytes) });
  const request: LaunchPinRequest = Object.freeze({ ...context.terms, ...words, image });
  const answer = await callVenue(async (signal) => context.launcher.pin(request, { signal }), call);
  const pin = answer.ok ? ownCopy(launchPinSchema, answer.value) : undefined;
  return pin === undefined ? err("venue_down") : ok(pin);
}

const buildAnswerSchema = z.object({ token: assetRefSchema, steps: z.array(z.unknown()) });

// The terms the launch's steps must keep (decision 0235), from its context and its upload.
function boundsOf(context: LaunchContext, upload: LaunchUpload, token: AssetRef): LaunchBounds {
  const { launcher, chain, terms } = context;
  const { minOutBase } = upload;
  return {
    ...terms,
    contracts: Object.values(terms.contracts),
    nativeAsset: nativeAssetOf(chain),
    metadataUri: upload.metadataUri,
    fee: upload.quote.fee,
    token,
    family: chain.family,
    ...(minOutBase === undefined ? {} : { minOutBase }),
    ...(launcher.noFirstBuyMin === true ? { noFirstBuyMin: true } : {}),
  };
}

// The checked plan; a first buy that carries no minimum is marked (decision 0270).
function planOf(
  launcher: Launcher,
  steps: readonly LaunchStep[],
  launch: DecodedLaunch,
): LaunchPlan {
  const isUnbound = launcher.noFirstBuyMin === true && launch.firstBuy !== undefined;
  return { steps, launch, ...(isUnbound ? { isFirstBuyUnbound: true } : {}) };
}

/** Asks a launch's launchpad to build its steps, and checks each one (decision 0235). */
export async function buildLaunch(
  context: LaunchContext,
  upload: LaunchUpload,
  call: VenueCallOptions,
): Promise<Result<LaunchPlan, VenueFailure> | LaunchRefused> {
  const { launcher, chain, terms } = context;
  const { quote, metadataUri, minOutBase } = upload;
  const minOut = minOutBase === undefined ? {} : { firstBuyMinOut: minOutBase };
  const request = Object.freeze({ ...terms, metadataUri, fee: quote.fee, ...minOut });
  const built = await callVenue(async (signal) => launcher.buildLaunch(request, { signal }), call);
  const answer = built.ok ? buildAnswerSchema.safeParse(built.value) : undefined;
  if (!built.ok || answer?.success !== true) {
    return err("venue_down");
  }
  const steps = readLaunchSteps(built.value.steps, { family: chain.family, launcher });
  if (!steps.ok) {
    return { ok: false, error: "decode_mismatch", mismatch: steps.error };
  }
  const checkedSteps = checkLaunchSteps(steps.value, boundsOf(context, upload, answer.data.token));
  return checkedSteps.ok
    ? ok(planOf(launcher, steps.value, checkedSteps.value))
    : { ok: false, error: "decode_mismatch", mismatch: checkedSteps.error };
}
