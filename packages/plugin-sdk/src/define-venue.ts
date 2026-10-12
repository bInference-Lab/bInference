import {
  type LaunchpadVenue,
  type Venue,
  type VenueCall,
  type VenueContracts,
  venueDeclarationSchema,
} from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";

function frozenCall(call: VenueCall): VenueCall {
  const { contract, abi, walletInputs } = call;
  return Object.freeze({ contract, abi, walletInputs: Object.freeze([...walletInputs]) });
}

function frozenContracts(contracts: readonly VenueContracts[]): readonly VenueContracts[] {
  return Object.freeze(
    contracts.map((item) =>
      Object.freeze({
        chain: item.chain,
        names: Object.freeze([...item.names]),
        ...(item.calls === undefined ? {} : { calls: Object.freeze(item.calls.map(frozenCall)) }),
        ...(item.spenders === undefined ? {} : { spenders: Object.freeze([...item.spenders]) }),
        ...(item.noDeadline === undefined ? {} : { noDeadline: item.noDeadline }),
      }),
    ),
  );
}

/**
 * Defines a venue plugin: a protocol the agent trades on. The definition declares the venue's id
 * and, for each chain it serves, the names of its contracts in that chain's registry entry; the
 * engine gives the venue those contracts' addresses with every request and refuses a transaction
 * to any other contract. It also names the functions its transactions call and the contracts an
 * approval may name as spender: a wallet's ceiling allows those and nothing else of the venue.
 *
 * The venue quotes, builds and decodes. `build` must spend exactly the request's input, pay its
 * output to the request's wallet, revert below `minOut` and after `deadlineMs`; `decode` reads
 * those terms back from the bytes alone. A chain whose trade calls have no deadline says so with
 * `noDeadline`, and its decoder then leaves the deadline out. The engine decodes every transaction
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
  };
  return Object.freeze(venue);
}

/**
 * Defines a launchpad plugin: a venue that trades the tokens on its bonding curve and reads its
 * curve. It checks and freezes the declaration as {@link defineVenue} does, and keeps `curve`,
 * which must answer from the launchpad's own contracts at the latest block: a token on its curve
 * with the asset the curve trades it against, any other token as off its curve.
 */
export function defineLaunchpad(definition: LaunchpadVenue): LaunchpadVenue {
  const venue = defineVenue(definition);
  const launchpad: LaunchpadVenue = {
    ...venue,
    curve: async (request, options) => definition.curve(request, options),
  };
  return Object.freeze(launchpad);
}
