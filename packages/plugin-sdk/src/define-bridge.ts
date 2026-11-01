import { type Bridge, chainRefSchema, venueDeclarationSchema } from "@binference/chain";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { frozenContracts } from "./define-venue.js";

// Each destination once, by a decimal id the bridge's deposit names it with.
const destinationsSchema = z
  .array(z.strictObject({ chain: chainRefSchema, id: z.string().regex(/^[1-9]\d{0,30}$/) }))
  .min(1)
  .refine((items) => new Set(items.map((item) => item.chain)).size === items.length);

function refused(problem: string): BinferenceError {
  return new BinferenceError({
    code: "plugin.bad_venue",
    message: `A bridge's declaration is wrong: ${problem}`,
  });
}

/**
 * Defines a bridge plugin: a venue that moves a token from the wallet's chain to an account on
 * another chain. It declares its contracts and calls as `defineVenue` does, so a ceiling holds its
 * deposit's rules, and the chains it delivers to, each once with the id its deposit names it by.
 * `build` must deposit exactly the request's input from the wallet to its recipient with a fill of
 * at least `minOut`, `decode` reads those terms back from the bytes alone, and `settlement` takes a
 * fill or refund as a deposit's own only from that deposit's own events.
 *
 * The declaration is checked at once: a bad one is a fault (`plugin.bad_venue`), so the plugin
 * fails when it loads. The returned bridge is frozen, and calls its methods on the definition.
 */
export function defineBridge(definition: Bridge): Bridge {
  const declaration = venueDeclarationSchema.safeParse(definition);
  if (!declaration.success) {
    throw refused(z.prettifyError(declaration.error));
  }
  const destinations = destinationsSchema.safeParse(definition.destinations);
  if (!destinations.success) {
    throw refused("its destinations are none, repeat a chain or give an id that is no number.");
  }
  return Object.freeze({
    id: declaration.data.id,
    contracts: frozenContracts(declaration.data.contracts),
    destinations: Object.freeze(destinations.data.map((item) => Object.freeze(item))),
    quote: async (request, options) => definition.quote(request, options),
    build: async (request, options) => definition.build(request, options),
    decode: (draft) => definition.decode(draft),
    status: async (deposit, options) => definition.status(deposit, options),
    settlement: (check) => definition.settlement(check),
  } satisfies Bridge);
}
