import { type ChainDefinition, type ChainRef, chainRefSchema } from "@binference/chain";
import { evmChainOf, evmFamilyId } from "@binference/chain-evm";

/**
 * The ids a ceiling's rules bind for each chain the registry defines (decision 0313): an EVM
 * chain's EIP-155 id as decimal text, which its send rules and the bridge rules that reach it
 * name. A chain of another family has none until a bridge venue declares the id it gives that
 * chain, so no rule pays an address saved there; a chain the registry lacks has none either.
 */
export function ruleChainIds(
  definitions: readonly ChainDefinition[],
): (chain: ChainRef) => readonly string[] {
  const ids = new Map(
    definitions
      .filter((definition) => definition.family === evmFamilyId)
      .map((definition) => [
        chainRefSchema.parse(definition.id),
        String(evmChainOf(definition).chainId),
      ]),
  );
  return (chain) => {
    const id = ids.get(chain);
    return id === undefined ? [] : [id];
  };
}

/**
 * The chains each id a ceiling's rules bind stands for, the reverse of {@link ruleChainIds}: an
 * EIP-155 id's EVM chain among the definitions; none for an id no definition gives.
 */
export function ruleChainsOf(
  definitions: readonly ChainDefinition[],
): (id: string) => readonly ChainRef[] {
  const idsOf = ruleChainIds(definitions);
  const chains = definitions.map((definition) => chainRefSchema.parse(definition.id));
  return (id) => chains.filter((chain) => idsOf(chain).includes(id));
}
