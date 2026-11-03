import { accountRefParts, venueDeclarationSchema } from "@binference/chain";
import type { IdentityRegistry } from "@binference/chain/identity";
import { BinferenceError } from "@binference/core";
import { z } from "zod";
import { frozenContracts } from "./define-venue.js";

function refused(problem: string): BinferenceError {
  return new BinferenceError({
    code: "plugin.bad_venue",
    message: `An identity registry's declaration is wrong: ${problem}`,
  });
}

/**
 * Defines an identity plugin: a registry on one chain where an agent registers its registration
 * file, minting an identity token to the wallet that signs. It declares its contracts and calls
 * as `defineVenue` does, so a ceiling holds their rules, all on its one chain, with no call that
 * pays another chain and no spender; its registry is its own account on that chain.
 *
 * The declaration is checked at once: a bad one is a fault (`plugin.bad_venue`), so the plugin
 * fails when it loads. The returned registry is frozen, and calls its methods on the definition.
 */
export function defineIdentity(definition: IdentityRegistry): IdentityRegistry {
  const declaration = venueDeclarationSchema.safeParse(definition);
  if (!declaration.success) {
    throw refused(z.prettifyError(declaration.error));
  }
  const { contracts } = declaration.data;
  if (contracts.length === 0 || contracts.some((item) => item.chain !== definition.chain)) {
    throw refused("it declares no contracts, or contracts on another chain than its registry.");
  }
  const calls = contracts.flatMap((item) => item.calls ?? []);
  const spenders = contracts.flatMap((item) => item.spenders ?? []);
  if (calls.some((call) => call.bridge !== undefined) || spenders.length > 0) {
    throw refused("it declares a bridge deposit or a spender, which a registry never needs.");
  }
  const { testedImplementation } = definition;
  const pins = [
    definition.registry,
    ...(testedImplementation === undefined ? [] : [testedImplementation]),
  ];
  if (pins.some((account) => accountRefParts(account).chain !== definition.chain)) {
    throw refused(
      "its registry or the implementation it pins is on another chain than it declares.",
    );
  }
  return Object.freeze({
    id: declaration.data.id,
    chain: definition.chain,
    registry: definition.registry,
    testedVersion: definition.testedVersion,
    ...(testedImplementation === undefined ? {} : { testedImplementation }),
    contracts: frozenContracts(contracts),
    fileOf: (card) => definition.fileOf(card),
    standing: async (wallet, options) => definition.standing(wallet, options),
    build: (request) => definition.build(request),
    decode: (draft) => definition.decode(draft),
    minted: (step, wallet) => definition.minted(step, wallet),
    landed: async (request, options) => definition.landed(request, options),
  } satisfies IdentityRegistry);
}
