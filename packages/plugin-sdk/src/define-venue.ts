import {
  type InsiderReader,
  type Launcher,
  type LaunchReader,
  launchOptionsSchema,
  type LaunchpadVenue,
  launchWordLimitsSchema,
  type PriceReader,
  type Venue,
  type VenueCall,
  type VenueContracts,
  venueDeclarationSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";

function frozenCall(call: VenueCall): VenueCall {
  const { contract, abi, walletInputs, isLaunchWalletOnly } = call;
  return Object.freeze({
    contract,
    abi,
    walletInputs: Object.freeze([...walletInputs]),
    ...(isLaunchWalletOnly === true ? { isLaunchWalletOnly } : {}),
  });
}

function frozenContracts(contracts: readonly VenueContracts[]): readonly VenueContracts[] {
  return Object.freeze(
    contracts.map((item) =>
      Object.freeze({
        chain: item.chain,
        names: Object.freeze([...item.names]),
        ...(item.calls === undefined ? {} : { calls: Object.freeze(item.calls.map(frozenCall)) }),
        ...(item.spenders === undefined ? {} : { spenders: Object.freeze([...item.spenders]) }),
        ...(item.launchContracts === undefined
          ? {}
          : { launchContracts: Object.freeze([...item.launchContracts]) }),
        ...(item.noDeadline === undefined ? {} : { noDeadline: item.noDeadline }),
      }),
    ),
  );
}

function hasPriceRead(venue: Venue): venue is Venue & PriceReader {
  return venue.priceRead !== undefined;
}

// A venue that declares its price reads keeps them, called on the definition.
function priceReadOf(definition: Venue): Pick<Venue, "priceRead"> {
  return hasPriceRead(definition)
    ? { priceRead: async (request, options) => definition.priceRead(request, options) }
    : {};
}

function hasInsiders(venue: Venue): venue is Venue & InsiderReader {
  return venue.insiders !== undefined;
}

// A launchpad that names the insiders of its launches keeps that read, called on the definition.
function insidersOf(definition: Venue): Pick<Venue, "insiders"> {
  return hasInsiders(definition)
    ? { insiders: async (request, options) => definition.insiders(request, options) }
    : {};
}

function hasLaunchReader(venue: Venue): venue is Venue & LaunchReader {
  return venue.launchEvents !== undefined && venue.readLaunches !== undefined;
}

// A launchpad whose launches the feed records keeps its events, each once in lowercase, and its
// reading, called on the definition. Events with no reading, or a reading with none, are a fault.
function launchReaderOf(definition: Venue): Partial<LaunchReader> {
  if (!hasLaunchReader(definition)) {
    if (definition.launchEvents !== undefined || definition.readLaunches !== undefined) {
      throw new BinferenceError({
        code: "plugin.bad_venue",
        message: "A launchpad declares its launch events and reads them, or does neither.",
      });
    }
    return {};
  }
  const events = definition.launchEvents.map((event) => event.toLowerCase());
  if (events.length === 0 || new Set(events).size !== events.length) {
    throw new BinferenceError({
      code: "plugin.bad_venue",
      message: "A launchpad's launch events are none, or one repeats.",
    });
  }
  return {
    launchEvents: Object.freeze(events),
    readLaunches: (request) => definition.readLaunches(request),
  };
}

/**
 * Defines a venue plugin: a protocol the agent trades on. The definition declares the venue's id
 * and, for each chain it serves, the names of its contracts in that chain's registry entry; the
 * engine gives the venue those contracts' addresses with every request and refuses a transaction
 * to any other contract. It also names the functions its transactions call and the contracts an
 * approval may name as spender: a wallet's ceiling allows those and nothing else of the venue.
 *
 * A launchpad whose every launch has contracts of its own, such as a curve per token, names them
 * as `launchContracts`; its curve read gives their addresses for a token it holds, and the engine
 * lets that token's trades and price reads call them.
 *
 * The venue quotes, builds and decodes. `build` must spend exactly the request's input, pay its
 * output to the request's wallet, revert below `minOut` and after `deadlineMs`; `decode` reads
 * those terms back from the bytes alone. A chain whose trade calls have no deadline says so with
 * `noDeadline`, and its decoder then leaves the deadline out. A venue that holds the state a
 * token's price comes from, such as a launchpad's curve, may declare `priceRead`: the calls that
 * read that state and the pure step that prices their answers, which the price watcher asks every
 * block. A launchpad whose contracts favor some wallets on a token it launched may declare
 * `insiders`, which names them for the risk step. A launchpad whose launches the launch feed
 * records declares `launchEvents`, the events its launches write, and `readLaunches`, which reads
 * launches and curve changes from one transaction's logs. The engine decodes every transaction
 * the venue builds and refuses one whose terms differ.
 *
 * The declaration is checked at once: a bad one is a fault (`plugin.bad_venue`), so the plugin
 * fails when it loads, never when it trades. The returned venue is frozen, and calls its methods
 * on the definition.
 */
export function defineVenue(definition: Venue): Venue {
  const declaration = venueDeclarationSchema.safeParse(definition);
  if (!declaration.success) {
    throw new BinferenceError({
      code: "plugin.bad_venue",
      message: `A venue's declaration is wrong: ${z.prettifyError(declaration.error)}`,
    });
  }
  const venue: Venue = {
    id: declaration.data.id,
    contracts: frozenContracts(declaration.data.contracts),
    quote: async (request, options) => definition.quote(request, options),
    build: async (request, options) => definition.build(request, options),
    decode: (draft) => definition.decode(draft),
    ...priceReadOf(definition),
    ...insidersOf(definition),
    ...launchReaderOf(definition),
  };
  return Object.freeze(venue);
}

// A launchpad's settings are checked as it loads; its launcher's methods are called on it.
function launcherOf(launcher: Launcher): Launcher {
  const options = launchOptionsSchema.safeParse(launcher.launchOptions);
  if (!options.success) {
    throw new BinferenceError({
      code: "plugin.bad_venue",
      message: `A launchpad's settings are wrong: ${z.prettifyError(options.error)}`,
    });
  }
  const limits =
    launcher.wordLimits === undefined
      ? undefined
      : launchWordLimitsSchema.safeParse(launcher.wordLimits);
  if (limits?.success === false) {
    throw new BinferenceError({
      code: "plugin.bad_venue",
      message: `A launchpad's word limits are wrong: ${z.prettifyError(limits.error)}`,
    });
  }
  const kept: Launcher = {
    launchOptions: Object.freeze(options.data.map((option) => Object.freeze({ ...option }))),
    ...(launcher.noFirstBuyMin === true ? { noFirstBuyMin: true } : {}),
    ...(limits === undefined ? {} : { wordLimits: Object.freeze({ ...limits.data }) }),
    quoteLaunch: async (terms, call) => launcher.quoteLaunch(terms, call),
    pin: async (request, call) => launcher.pin(request, call),
    pinStatus: async (pin, call) => launcher.pinStatus(pin, call),
    buildLaunch: async (request, call) => launcher.buildLaunch(request, call),
    decodeLaunch: (draft) => launcher.decodeLaunch(draft),
  };
  return Object.freeze(kept);
}

/**
 * Defines a launchpad plugin: a venue that trades the tokens on its bonding curve and reads its
 * curve. It checks and freezes the declaration as {@link defineVenue} does, and keeps `curve`,
 * which must answer from the launchpad's own contracts at the latest block: a token on its curve
 * with the asset the curve trades it against, any other token as off its curve. A launchpad that
 * launches tokens keeps its `launcher`, whose declared settings are checked at once.
 */
export function defineLaunchpad(definition: LaunchpadVenue): LaunchpadVenue {
  const venue = defineVenue(definition);
  const { launcher } = definition;
  const launchpad: LaunchpadVenue = {
    ...venue,
    curve: async (request, options) => definition.curve(request, options),
    ...(launcher === undefined ? {} : { launcher: launcherOf(launcher) }),
  };
  return Object.freeze(launchpad);
}
