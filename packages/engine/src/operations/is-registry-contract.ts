import {
  type AccountRef,
  accountRefParts,
  type ChainRegistry,
  type ContractDefinition,
} from "@binference/chain";

/**
 * The contract the chain registry lists at the account on its chain, such as a venue's router or
 * Relay's depository, in any letter case its family reads; `undefined` for an account on a chain
 * the registry lacks, that its family cannot read, or that the registry does not list.
 */
export function registryContractOf(
  account: AccountRef,
  chains: ChainRegistry,
): ContractDefinition | undefined {
  const { chain, address } = accountRefParts(account);
  const registered = chains.get(chain);
  if (!registered.ok) {
    return undefined;
  }
  const { family, definition } = registered.value;
  const typed = family.parseAddress(address);
  return typed.ok
    ? definition.contracts.find((contract) => {
        const listed = family.parseAddress(contract.address);
        return listed.ok && listed.value === typed.value;
      })
    : undefined;
}

/** Whether the chain registry lists a contract at the account on its chain. */
export function isRegistryContract(account: AccountRef, chains: ChainRegistry): boolean {
  return registryContractOf(account, chains) !== undefined;
}
