import { venueDeclarationSchema } from "@binference/chain";
import type { StakingVenue } from "@binference/chain/staking";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { frozenContracts } from "./define-venue.js";

function refused(problem: string): BinferenceError {
  return new BinferenceError({
    code: "plugin.bad_venue",
    message: `A staking venue's declaration is wrong: ${problem}`,
  });
}

/**
 * Defines a staking plugin: a venue that stakes its chain's coin with validators. It declares its
 * contracts and calls as `defineVenue` does, so a ceiling holds their rules, all on the one chain
 * it stakes on, and no call that pays another chain. `plan` reads the chain and names a refusal
 * as an answer, `build` makes the planned call from the plan's wallet and crediting it alone, and
 * `decode` reads back only calls whose coin and receipt token go to the account that signs.
 *
 * The declaration is checked at once: a bad one is a fault (`plugin.bad_venue`), so the plugin
 * fails when it loads. The returned venue is frozen, and calls its methods on the definition.
 */
export function defineStaking(definition: StakingVenue): StakingVenue {
  const declaration = venueDeclarationSchema.safeParse(definition);
  if (!declaration.success) {
    throw refused(z.prettifyError(declaration.error));
  }
  const { contracts } = declaration.data;
  if (contracts.length === 0 || contracts.some((item) => item.chain !== definition.chain)) {
    throw refused("it declares no contracts, or contracts on another chain than it stakes on.");
  }
  if (contracts.some((item) => (item.calls ?? []).some((call) => call.bridge !== undefined))) {
    throw refused("it declares a bridge deposit, which pays another chain.");
  }
  return Object.freeze({
    id: declaration.data.id,
    chain: definition.chain,
    contracts: frozenContracts(contracts),
    options: async (options) => definition.options(options),
    holdings: async (wallet, options) => definition.holdings(wallet, options),
    receipt: async (validator, options) => definition.receipt(validator, options),
    plan: async (request, options) => definition.plan(request, options),
    build: async (plan, options) => definition.build(plan, options),
    decode: (draft) => definition.decode(draft),
    landed: async (move, options) => definition.landed(move, options),
  } satisfies StakingVenue);
}
