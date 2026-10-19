import {
  assetRefParts,
  type ChainRef,
  type ChainRegistry,
  type Launcher,
  launchOptionsSchema,
  type LaunchPin,
  type LaunchQuote,
  type PinStatus,
  pinStatusSchema,
  type RegisteredChain,
  type Venue,
} from "@binference/chain";
import { BinferenceError, type Clock, err, type JsonValue, type Result } from "@binference/core";
import type { LaunchTokenRequest } from "@binference/protocol";
import { callVenue, type VenueCallOptions } from "./call-venue.js";
import { type HostedVenue, hostVenues } from "./hosted-venue.js";
import {
  buildLaunch,
  type HostedLaunch,
  type LaunchContext,
  type LaunchPlan,
  type LaunchRefused,
  type LaunchUpload,
  type LaunchWords,
  pinLaunch,
  quoteLaunch,
} from "./launch-calls.js";
import {
  type LaunchSetting,
  launchSettingsOf,
  launchSettingsProblem,
} from "./launch-settings.schema.js";
import type { VenueFailure } from "./venue-host.js";

/**
 * The launch side of the venue host (decision 0234): it runs each launchpad's launcher inside the
 * engine under the host's timeout, gives it the launchpad's registry contracts, and refuses what it
 * builds that it cannot read or that breaks the launch's terms (decision 0235).
 */
export interface LaunchHost {
  /**
   * The launchpad's settings for a request: each it declares, with the request's value or its
   * default. A venue that launches no token on the chain is `no_launchpad`; a request's settings
   * that do not fit are `bad_settings`.
   */
  settingsOf(
    venue: string,
    chain: ChainRef,
    given: LaunchTokenRequest["venueOptions"],
  ): Result<readonly LaunchSetting[], "no_launchpad" | "bad_settings">;
  /**
   * The launch fee and the first buy's output, read from the launchpad's contracts. A pair it does
   * not launch against is `no_route`; a launchpad that throws, times out or answers outside its
   * types is `venue_down`; a fee in another asset than the chain's coin, or a first buy's output
   * that the terms do not ask for or that is nothing, is `decode_mismatch`.
   */
  quote(
    launch: HostedLaunch,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LaunchQuote, VenueFailure>>;
  /** Uploads the launch's words and picture; a launchpad that cannot is `venue_down`. */
  pin(
    launch: HostedLaunch,
    words: LaunchWords,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LaunchPin, "venue_down">>;
  /** Where a pin stands; a launchpad that throws, times out or answers outside its type: pending. */
  pinStatus(
    venue: string,
    pin: JsonValue,
    options: { readonly signal: AbortSignal },
  ): Promise<PinStatus>;
  /** Builds the launch's steps and checks each one; `decode_mismatch` names the failed check. */
  build(
    launch: HostedLaunch,
    upload: LaunchUpload,
    options: { readonly signal: AbortSignal },
  ): Promise<Result<LaunchPlan, VenueFailure> | LaunchRefused>;
}

/** What the launch host is made from: every venue the engine may use, as the venue host is. */
export interface LaunchHostOptions {
  readonly venues: readonly Venue[];
  readonly chains: ChainRegistry;
  readonly clock: Clock;
  /** How long one quote, build or pin read may take before the launchpad counts as down. */
  readonly callTimeoutMs: number;
  /** How long one upload of the words and picture may take: 12 s when absent. */
  readonly uploadTimeoutMs?: number;
}

// An upload carries a picture of up to 5 MiB, so it gets longer than a read: with a quote, a
// build and the first pin read at the call timeout, a launch's proposal stays under 30 s.
const defaultUploadTimeoutMs = 12_000;

/** A launchpad the host holds that launches tokens, with its declared contracts. */
interface HostedLauncher {
  readonly hosted: HostedVenue;
  readonly launcher: Launcher;
}

// A launchpad's settings must pass their schema, however the venue reached the host, and have
// their card lines and fitting defaults on each chain it serves.
function problemOf(item: HostedLauncher, chain: RegisteredChain): string | undefined {
  const { launchOptions } = item.launcher;
  return launchOptionsSchema.safeParse(launchOptions).success
    ? launchSettingsProblem(launchOptions, chain)
    : "its settings break the declaration's rules.";
}

function checked(item: HostedLauncher, chains: ChainRegistry): HostedLauncher {
  for (const chainRef of item.hosted.contracts.keys()) {
    const chain = chains.get(chainRef);
    const problem = chain.ok ? problemOf(item, chain.value) : undefined;
    if (problem !== undefined) {
      throw new BinferenceError({
        code: "venue.bad_declaration",
        message: `The launchpad ${item.hosted.venue.id} cannot be hosted: ${problem}`,
        details: { venue: item.hosted.venue.id },
      });
    }
  }
  return item;
}

function launchersOf(options: LaunchHostOptions): ReadonlyMap<string, HostedLauncher> {
  const hosted = hostVenues(options.venues, options.chains);
  const launchers = [...hosted.values()].flatMap((item) => {
    const { launcher } = item.venue;
    return launcher === undefined
      ? []
      : [[item.venue.id, checked({ hosted: item, launcher }, options.chains)] as const];
  });
  return new Map(launchers);
}

function contextOf(
  launchers: ReadonlyMap<string, HostedLauncher>,
  chains: ChainRegistry,
  launch: HostedLaunch,
): LaunchContext | undefined {
  const item = launchers.get(launch.venue);
  const chain = chains.get(assetRefParts(launch.pair).chain);
  const contracts = chain.ok ? item?.hosted.contracts.get(chain.value.ref) : undefined;
  if (item === undefined || !chain.ok || contracts === undefined) {
    return undefined;
  }
  const { venue: _venue, settings, ...rest } = launch;
  const options = Object.fromEntries(settings.map((setting) => [setting.name, setting.value]));
  const terms = Object.freeze({ ...rest, options: Object.freeze(options), contracts });
  return { launcher: item.launcher, chain: chain.value, terms };
}

/** What every method of the launch host reads: its launchpads, the registry and its timeout. */
interface LaunchParts {
  readonly launchers: ReadonlyMap<string, HostedLauncher>;
  readonly chains: ChainRegistry;
  readonly callOf: (signal: AbortSignal) => VenueCallOptions;
}

/** What one call does on a launch's launchpad, and its answer when the host cannot place it. */
interface OnLaunchpad<T> {
  readonly run: (context: LaunchContext) => Promise<T>;
  readonly missing: T;
}

// Runs the call on the launch's launchpad and chain; a launch the host cannot place is `missing`.
async function onLaunchpad<T>(
  parts: LaunchParts,
  launch: HostedLaunch,
  call: OnLaunchpad<T>,
): Promise<T> {
  const context = contextOf(parts.launchers, parts.chains, launch);
  return context === undefined ? call.missing : await call.run(context);
}

async function readPin(
  parts: LaunchParts,
  asked: { readonly venue: string; readonly pin: JsonValue },
  signal: AbortSignal,
): Promise<PinStatus> {
  const { venue, pin } = asked;
  const launcher = parts.launchers.get(venue)?.launcher;
  if (launcher === undefined) {
    return "pending";
  }
  const answer = await callVenue(
    async (stop) => launcher.pinStatus(pin, { signal: stop }),
    parts.callOf(signal),
  );
  const status = answer.ok ? pinStatusSchema.safeParse(answer.value) : undefined;
  return status?.success === true ? status.data : "pending";
}

function settingsOn(
  parts: LaunchParts,
  asked: {
    readonly venue: string;
    readonly chainRef: ChainRef;
    readonly given: LaunchTokenRequest["venueOptions"];
  },
): Result<readonly LaunchSetting[], "no_launchpad" | "bad_settings"> {
  const { venue, chainRef, given } = asked;
  const item = parts.launchers.get(venue);
  const chain = parts.chains.get(chainRef);
  if (item === undefined || !chain.ok || !item.hosted.contracts.has(chainRef)) {
    return err("no_launchpad");
  }
  return launchSettingsOf(item.launcher.launchOptions, given, chain.value);
}

/**
 * Creates the {@link LaunchHost} over every venue the engine may use, checked against the chain
 * registry as the venue host checks them. A launchpad whose settings have no card line in every
 * language, or a default that does not fit, is a fault: the engine refuses to start.
 */
export function createLaunchHost(options: LaunchHostOptions): LaunchHost {
  const { chains, clock, callTimeoutMs } = options;
  const uploadTimeoutMs = options.uploadTimeoutMs ?? defaultUploadTimeoutMs;
  const callOf = (signal: AbortSignal): VenueCallOptions => ({
    clock,
    signal,
    timeoutMs: callTimeoutMs,
  });
  const parts: LaunchParts = { launchers: launchersOf(options), chains, callOf };
  return {
    settingsOf: (venue, chainRef, given) => settingsOn(parts, { venue, chainRef, given }),
    async quote(launch, { signal }) {
      signal.throwIfAborted();
      const run = async (context: LaunchContext) => quoteLaunch(context, callOf(signal));
      return onLaunchpad(parts, launch, { run, missing: err("no_route") });
    },
    async pin(launch, words, { signal }) {
      signal.throwIfAborted();
      const upload = { ...callOf(signal), timeoutMs: uploadTimeoutMs };
      const run = async (context: LaunchContext) => pinLaunch(context, words, upload);
      return onLaunchpad(parts, launch, { run, missing: err("venue_down") });
    },
    async pinStatus(venue, pin, { signal }) {
      signal.throwIfAborted();
      return readPin(parts, { venue, pin }, signal);
    },
    async build(launch, upload, { signal }) {
      signal.throwIfAborted();
      const run = async (context: LaunchContext) => buildLaunch(context, upload, callOf(signal));
      return onLaunchpad(parts, launch, { run, missing: err("no_route") });
    },
  };
}
