import { BinferenceError, err, ok } from "@binference/core";
import { type ChainRef, chainRefParts, parseChainRef } from "../caip/chain-ref.js";
import type { ChainFamily, ChainRegistry, SigningScheme } from "../ports.js";
import { type ChainDefinition, chainDefinitionSchema } from "./chain-definition.js";
import type { RegisteredChain } from "./registered-chain.js";

/** What the composition root registers. */
export interface ChainRegistryOptions {
  readonly chains: readonly ChainDefinition[];
  readonly families: readonly ChainFamily[];
  readonly signingSchemes: readonly SigningScheme[];
}

function refuse(definition: ChainDefinition, problem: string): BinferenceError {
  return new BinferenceError({
    code: "chain.bad_definition",
    message: `The chain ${definition.key} cannot be registered: ${problem}`,
    details: { chain: definition.key },
  });
}

function checkedRef(definition: ChainDefinition): ChainRef {
  const shape = chainDefinitionSchema.safeParse(definition);
  const ref = parseChainRef(definition.id);
  if (!shape.success || !ref.ok) {
    throw refuse(definition, shape.error?.issues[0]?.message ?? "its id is not CAIP-2.");
  }
  return ref.value;
}

// Every address must already be in the family's canonical form, so the registry is the one
// spelling of each contract and token.
function checkAddresses(definition: ChainDefinition, family: ChainFamily): void {
  const addresses = [...definition.tokens, ...definition.contracts].map((item) => item.address);
  const wrong = addresses.find((address) => {
    const parsed = family.parseAddress(address);
    return !parsed.ok || parsed.value !== address;
  });
  if (wrong !== undefined) {
    throw refuse(definition, `${wrong} is not in its family's canonical form.`);
  }
}

function register(definition: ChainDefinition, options: ChainRegistryOptions): RegisteredChain {
  const ref = checkedRef(definition);
  const family = options.families.find((item) => item.id === definition.family);
  const signingScheme = options.signingSchemes.find((item) => item.family === definition.family);
  if (family === undefined || signingScheme === undefined) {
    throw refuse(definition, `no family or signing scheme is registered as ${definition.family}.`);
  }
  if (chainRefParts(ref).namespace !== family.namespace) {
    throw refuse(definition, `its namespace is not the ${family.id} family's.`);
  }
  checkAddresses(definition, family);
  return { ref, definition, family, signingScheme };
}

/**
 * Creates the registry from chain data, families and signing schemes. Data that breaks the chain
 * definition schema, names an unknown family, repeats a chain, or spells an address outside its
 * family's canonical form is a fault: the registry refuses to start.
 */
export function createChainRegistry(options: ChainRegistryOptions): ChainRegistry {
  const chains = options.chains.map((definition) => register(definition, options));
  const byRef = new Map(chains.map((chain) => [chain.ref, chain]));
  const keys = new Set(chains.map((chain) => chain.definition.key));
  if (byRef.size !== chains.length || keys.size !== chains.length) {
    throw new BinferenceError({
      code: "chain.duplicate_chain",
      message: "Two chain definitions share an id or a key.",
    });
  }
  return {
    get(ref) {
      const chain = byRef.get(ref);
      return chain === undefined ? err("unknown_chain") : ok(chain);
    },
    list: () => chains,
  };
}
