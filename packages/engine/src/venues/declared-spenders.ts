import {
  type AccountRef,
  accountRefSchema,
  declaredAddress,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";

/**
 * The spenders a venue declares on a chain, any wallet's to approve, as the registry places them;
 * a name the registry does not list adds none, so no approval may name it.
 */
export function declaredSpenders(
  venue: VenueDeclaration,
  chain: RegisteredChain,
): readonly AccountRef[] {
  return venue.contracts
    .filter((entry) => entry.chain === chain.ref)
    .flatMap((entry) => entry.spenders ?? [])
    .flatMap((name) => {
      const found = declaredAddress(venue, chain, name);
      return found.ok ? [accountRefSchema.parse(`${chain.ref}:${found.value}`)] : [];
    });
}
