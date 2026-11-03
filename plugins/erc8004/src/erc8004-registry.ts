import {
  type AccountRef,
  accountRefParts,
  BinferenceError,
  type ChainRef,
  defineIdentity,
  type IdentityRegistry,
  type VenueDeclaration,
} from "@binference/plugin-sdk";
import { parseEvmAddress, type RpcFailover } from "@binference/plugin-sdk/evm";
import {
  buildRegistration,
  decodeRegistration,
  mintedTo,
  type RegistryAt,
} from "./calls/register-call.js";
import {
  erc8004ContractsOn,
  identityImplementationName,
  identityRegistryName,
} from "./erc8004-contracts.js";
import { registrationFileOf } from "./file/registration-file.js";
import { readLanded, readStanding } from "./registry/read-registry.js";

/** The plugin's id, which the chain registry names the identity registry after. */
export const erc8004Id = "erc8004";

/**
 * The registry version the plugin was tested with on a fork of BSC: the reference registry 2.0.0.
 * A registry that reports another is refused before any card (decision 0335).
 */
export const erc8004TestedVersion = "2.0.0";

/** What the ERC-8004 identity registry reads and builds with on its chain. */
export interface Erc8004Options {
  readonly chain: ChainRef;
  /** The chain's RPC failover, which gives every read its timeout per endpoint. */
  readonly rpc: RpcFailover;
  /**
   * The `erc8004` contracts of the chain registry on that chain, by their registry names: the
   * registry, and the implementation its proxy ran when the plugin was tested, when pinned.
   */
  readonly contracts: Readonly<Record<string, AccountRef>>;
}

/** What the plugin declares on the chains given, without a chain to read. */
export function erc8004Declaration(chains: readonly ChainRef[]): VenueDeclaration {
  return { id: erc8004Id, contracts: chains.map(erc8004ContractsOn) };
}

function registryOf(options: Erc8004Options): {
  readonly at: RegistryAt;
  readonly ref: AccountRef;
} {
  const ref = options.contracts[identityRegistryName];
  const parts = ref === undefined ? undefined : accountRefParts(ref);
  const address = parts === undefined ? undefined : parseEvmAddress(parts.address);
  if (ref === undefined || parts?.chain !== options.chain || address?.ok !== true) {
    throw new BinferenceError({
      code: "erc8004.bad_options",
      message: "The chain registry lists no ERC-8004 identity registry of the plugin's chain.",
    });
  }
  return { at: { chain: options.chain, address: address.value }, ref };
}

// The contract the chain registry pins as the one the registry's proxy ran when it was tested.
function testedImplementationOf(
  options: Erc8004Options,
): Pick<IdentityRegistry, "testedImplementation"> {
  const pinned = options.contracts[identityImplementationName];
  if (pinned !== undefined && accountRefParts(pinned).chain !== options.chain) {
    throw new BinferenceError({
      code: "erc8004.bad_options",
      message: "The chain registry pins the registry's implementation on another chain.",
    });
  }
  return pinned === undefined ? {} : { testedImplementation: pinned };
}

/**
 * Creates the ERC-8004 identity registry on one chain, over the registry the chain registry lists:
 * it writes a registration file as decision 0334 sets it, reads a wallet's standing at the latest
 * block, builds and decodes only `register(string)` with no coin, counts the ERC-721 mints a
 * simulated step made to a wallet, and reads back a landed registration from its `Registered`
 * event, then the holder and the file at the latest block. A missing or foreign registry is
 * `erc8004.bad_options`; a wallet of another chain `erc8004.bad_request`; a registry that reverts
 * a view or answers outside its shape `erc8004.read_failed`.
 */
export function createErc8004Registry(options: Erc8004Options): IdentityRegistry {
  const { chain, rpc } = options;
  const { at, ref } = registryOf(options);
  const read = (signal: AbortSignal) => ({ rpc, registry: at, signal });
  return defineIdentity({
    ...erc8004Declaration([chain]),
    chain,
    registry: ref,
    testedVersion: erc8004TestedVersion,
    ...testedImplementationOf(options),
    fileOf: (card) => {
      if (accountRefParts(card.wallet).chain !== chain) {
        throw new BinferenceError({
          code: "erc8004.bad_request",
          message: "A registration file lists a wallet of the registry's chain.",
        });
      }
      return registrationFileOf(card);
    },
    standing: async (wallet, { signal }) => readStanding(read(signal), wallet),
    build: (request) => buildRegistration(at, request),
    decode: (draft) => decodeRegistration(at, draft),
    minted: (step, wallet) => mintedTo(at, step, wallet),
    landed: async (request, { signal }) => readLanded(read(signal), request),
  });
}
