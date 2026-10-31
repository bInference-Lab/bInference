import {
  type AccountRef,
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type ChainRef,
  type NameResolution,
  type NameResolver,
} from "@binference/plugin-sdk";
import { parseEvmAddress, type RpcFailover } from "@binference/plugin-sdk/evm";
import type { Address } from "viem";
import { type BnbName, bnbNameOf, bnbSuffix } from "./names/bnb-name.js";
import { type BlockRead, holdsCode, readLatestBlock } from "./registry/read-at-block.js";
import {
  readAddressRecord,
  readReverseRecord,
  type SpaceIdContracts,
} from "./registry/read-records.js";

/** The registry names of the contracts the resolver reads, as the chain registry lists them. */
export const spaceIdContractNames = { registry: "registry", baseRegistrar: "base-registrar" };

/** What the `.bnb` name resolver reads with on its chain. */
export interface SpaceIdOptions {
  readonly chain: ChainRef;
  /** The chain's RPC failover, which gives every read its timeout per endpoint. */
  readonly rpc: RpcFailover;
  /** The `spaceid` contracts of the chain registry on that chain, by their registry names. */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

function badOptions(problem: string): BinferenceError {
  return new BinferenceError({ code: "spaceid.bad_options", message: problem });
}

function contractOf(options: SpaceIdOptions, name: string): Address {
  const account = options.contracts[name];
  if (account === undefined) {
    throw badOptions(`The chain registry lists no SPACE ID contract named ${name}.`);
  }
  const parts = accountRefParts(account);
  const address = parseEvmAddress(parts.address);
  if (parts.chain !== options.chain || !address.ok) {
    throw badOptions(`SPACE ID's ${name} is not an account of the resolver's chain.`);
  }
  return address.value;
}

function contractsOf(options: SpaceIdOptions): SpaceIdContracts {
  return {
    registry: contractOf(options, spaceIdContractNames.registry),
    baseRegistrar: contractOf(options, spaceIdContractNames.baseRegistrar),
  };
}

async function resolveAt(
  read: BlockRead & { readonly now: bigint; readonly chain: ChainRef },
  contracts: SpaceIdContracts,
  name: BnbName,
): Promise<NameResolution> {
  const address = await readAddressRecord(read, contracts, name);
  if (address === undefined) {
    return { kind: "not_found", name: name.name };
  }
  const account = accountRefSchema.parse(`${read.chain}:${address}`);
  if (await holdsCode(read, address)) {
    return { kind: "contract", name: name.name, address: account };
  }
  const reverse = await readReverseRecord(read, contracts, { address, name: name.name });
  const found = { kind: "found", name: name.name, address: account } as const;
  return reverse === undefined ? found : { ...found, reverse };
}

/**
 * Creates the `.bnb` name resolver over SPACE ID's contracts on one chain. Each call reads the
 * latest block and then every record at that block: the base registrar's expiry of the name's
 * second-level label, the registry's resolver for the name, that resolver's `addr`, whether the
 * address holds code, and the address's reverse record through the resolver the registry names
 * for it. It never assumes a resolver and caches nothing. Missing or foreign contracts are a fault
 * (`spaceid.bad_options`).
 */
export function createSpaceIdResolver(options: SpaceIdOptions): NameResolver {
  const contracts = contractsOf(options);
  const { chain, rpc } = options;
  return {
    chain,
    suffix: bnbSuffix,
    async resolve(text, { signal }) {
      signal.throwIfAborted();
      const name = bnbNameOf(text);
      if (name === undefined) {
        return { kind: "malformed" };
      }
      const head = await readLatestBlock(rpc, signal);
      const read = { rpc, block: head.number, now: head.timestamp, signal, chain };
      return resolveAt(read, contracts, name);
    },
  };
}
