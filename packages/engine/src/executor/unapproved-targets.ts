import {
  type AccountRef,
  accountRefSchema,
  declaredAddress,
  type RegisteredChain,
  type VenueDeclaration,
} from "@binference/chain";

/**
 * The contracts an approval is never sent to on a chain (decision 0304): each one any enabled
 * venue marks `unapproved` there, read from the registry by name, whether or not the intent's route
 * uses that venue. A name the registry lacks adds none.
 */
export function unapprovedTargetsOf(
  chain: RegisteredChain,
  venues: readonly VenueDeclaration[],
): readonly AccountRef[] {
  const addresses = venues.flatMap((venue) =>
    venue.contracts
      .filter((item) => item.chain === chain.ref)
      .flatMap((item) => item.unapproved ?? [])
      .flatMap((name) => {
        const address = declaredAddress(venue, { definition: chain.definition }, name);
        return address.ok ? [address.value] : [];
      }),
  );
  return [...new Set(addresses)].map((address) =>
    accountRefSchema.parse(`${chain.ref}:${address}`),
  );
}
