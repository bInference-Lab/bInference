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
  type LaunchOptionValue,
  type LaunchQuote,
  launchQuoteSchema,
  type LaunchTerms,
  type LaunchWords,
  type RegisteredChain,
  type UsdPrice,
  writtenPictureSchema,
  writtenWordsOf,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { z } from "zod";
import { sha256HexOfBytes } from "../records/sha256-hex.js";
import type { BuildMismatch } from "./build-checks.js";
import { callVenue, ownCopy, type VenueCallOptions } from "./call-venue.js";
import { nativeAssetOf } from "./host-terms.js";
import {
  checkLaunchSteps,
  type LaunchBounds,
  type LaunchStep,
  readLaunchSteps,
} from "./launch-checks.js";
import { type LaunchSetting, quotedSettingOf } from "./launch-settings.schema.js";
import type { VenueFailure } from "./venue-host.js";

/**
 * A launch the host quotes, pins and builds on one launchpad, from the agent's launch wallet, with
 * the words its card shows.
 */
export interface HostedLaunch extends LaunchWords {
  readonly venue: string;
  readonly wallet: AccountRef;
  readonly name: string;
  readonly symbol: string;
  readonly pair: AssetRef;
  readonly firstBuy?: Amount;
  readonly settings: readonly LaunchSetting[];
  /** binference's USD price of the pair when the launch is quoted; absent when it has none. */
  readonly pairUsdPrice?: UsdPrice;
}

/** The picture a launchpad uploads and pins for a launch, or writes into its create call. */
export type UploadedPicture = LaunchPinRequest["image"];

/** What a launch is built from once its quote and its upload, if any, are in hand. */
export interface LaunchUpload {
  readonly quote: LaunchQuote;
  /** The metadata address the upload gave; absent for a launchpad that uploads nothing. */
  readonly metadataUri?: string;
  /**
   * The owner's picture, for a launchpad that writes it into its create call (decision 0279);
   * absent for any other.
   */
  readonly picture?: UploadedPicture;
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
  /** The launch's description and links, which a launchpad that keeps them on chain writes. */
  readonly words: LaunchWords;
  /**
   * The create call's first buy carries no minimum: the launcher declares it, and the registry
   * lists the launchpad as one whose create call runs its first buy so (decision 0270).
   */
  readonly isFirstBuyUnbound: boolean;
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

// The quote's values for optional settings the terms leave out, each fit to its declaration and
// in its canonical form (decision 0280); `undefined` when one is not.
function quotedSettingsOf(
  quote: LaunchQuote,
  context: LaunchContext,
): Readonly<Record<string, LaunchOptionValue>> | undefined {
  const named = Object.entries(quote.settings ?? {});
  const fitted = named.flatMap(([name, value]: readonly [string, LaunchOptionValue]) => {
    const option = context.launcher.launchOptions.find((item) => item.name === name);
    const isLeftOut = context.terms.options[name] === undefined;
    const setting =
      option === undefined || !isLeftOut
        ? undefined
        : quotedSettingOf(option, value, context.chain);
    return setting === undefined ? [] : [[setting.name, setting.value] as const];
  });
  return fitted.length === named.length ? Object.fromEntries(fitted) : undefined;
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
  const settings = quotedSettingsOf(quote.value, context);
  if (!isQuoteShaped(quote.value, context) || settings === undefined) {
    return err("decode_mismatch");
  }
  const { settings: _settings, ...rest } = quote.value;
  return ok(Object.keys(settings).length === 0 ? rest : { ...rest, settings });
}

/**
 * Asks a launch's launchpad to upload and pin its words and picture. The launchpad gets its own
 * copy of the picture's bytes, so nothing it writes there changes the caller's.
 */
export async function pinLaunch(
  context: LaunchContext,
  picture: UploadedPicture,
  call: VenueCallOptions,
): Promise<Result<LaunchPin, "venue_down">> {
  const { launcher } = context;
  if (launcher.pin === undefined) {
    return err("venue_down");
  }
  const image = Object.freeze({ ...picture, bytes: Uint8Array.from(picture.bytes) });
  const request: LaunchPinRequest = Object.freeze({ ...context.terms, ...context.words, image });
  const answer = await callVenue(async (signal) => launcher.pin?.(request, { signal }), call);
  const pin = answer.ok ? ownCopy(launchPinSchema, answer.value) : undefined;
  return pin === undefined ? err("venue_down") : ok(pin);
}

const buildAnswerSchema = z.object({ token: assetRefSchema, steps: z.array(z.unknown()) });

// The picture the create call must write, by its type and digest; none without one.
function writtenPictureOf(picture: UploadedPicture | undefined): Pick<LaunchBounds, "picture"> {
  const written =
    picture === undefined
      ? undefined
      : writtenPictureSchema.safeParse({
          contentType: picture.contentType,
          sha256: sha256HexOfBytes(picture.bytes),
        });
  return written?.success === true ? { picture: written.data } : {};
}

// The terms the launch's steps must keep (decision 0235), from its context and its upload.
function boundsOf(context: LaunchContext, upload: LaunchUpload, token: AssetRef): LaunchBounds {
  const { chain, terms } = context;
  const { minOutBase } = upload;
  return {
    ...terms,
    contracts: Object.values(terms.contracts),
    nativeAsset: nativeAssetOf(chain),
    ...(upload.metadataUri === undefined ? {} : { metadataUri: upload.metadataUri }),
    ...writtenPictureOf(upload.picture),
    words: writtenWordsOf(context.words),
    mustWriteWords: context.launcher.wordLimits !== undefined,
    fee: upload.quote.fee,
    token,
    family: chain.family,
    ...(minOutBase === undefined ? {} : { minOutBase }),
    ...(context.isFirstBuyUnbound ? { noFirstBuyMin: true } : {}),
  };
}

// The checked plan; a first buy that carries no minimum is marked (decision 0270).
function planOf(
  context: LaunchContext,
  steps: readonly LaunchStep[],
  launch: DecodedLaunch,
): LaunchPlan {
  const isUnbound = context.isFirstBuyUnbound && launch.firstBuy !== undefined;
  return { steps, launch, ...(isUnbound ? { isFirstBuyUnbound: true } : {}) };
}

/** Asks a launch's launchpad to build its steps, and checks each one (decision 0235). */
export async function buildLaunch(
  context: LaunchContext,
  upload: LaunchUpload,
  call: VenueCallOptions,
): Promise<Result<LaunchPlan, VenueFailure> | LaunchRefused> {
  const { launcher, chain, terms, words } = context;
  const { quote, metadataUri, minOutBase, picture } = upload;
  const minOut = minOutBase === undefined ? {} : { firstBuyMinOut: minOutBase };
  const metadata = metadataUri === undefined ? {} : { metadataUri };
  // The launchpad gets its own copy of the picture's bytes, as an upload does.
  const written =
    picture === undefined
      ? {}
      : { picture: Object.freeze({ ...picture, bytes: Uint8Array.from(picture.bytes) }) };
  const request = Object.freeze({
    ...terms,
    ...words,
    ...metadata,
    ...written,
    fee: quote.fee,
    ...minOut,
  });
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
    ? ok(planOf(context, steps.value, checkedSteps.value))
    : { ok: false, error: "decode_mismatch", mismatch: checkedSteps.error };
}
