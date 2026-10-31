import { type AccountRef, accountRefParts, type ChainRegistry } from "@binference/chain";

/**
 * Whether the account is a contract the chain registry lists on its chain, such as a venue's
 * router or Relay's depository, in any letter case its family reads. An account on a chain the
 * registry lacks, or that its family cannot read, is none.
 */
export function isRegistryContract(account: AccountRef, chains: ChainRegistry): boolean {
  const { chain, address } = accountRefParts(account);
  const registered = chains.get(chain);
  if (!registered.ok) {
    return false;
  }
  const { family, definition } = registered.value;
  const typed = family.parseAddress(address);
  return (
    typed.ok &&
    definition.contracts.some((contract) => {
      const listed = family.parseAddress(contract.address);
      return listed.ok && listed.value === typed.value;
    })
  );
}
