import {
  type AccountRef,
  type JsonValue,
  accountRefParts,
  accountRefSchema,
  BinferenceError,
  type ChainRef,
  type DecodedRegistration,
  err,
  ok,
  type Result,
  type SimulatedStep,
  type TxDraft,
} from "@binference/plugin-sdk";
import {
  callAbiJson,
  decodeCall,
  decodeEvmDraft,
  decodeLog,
  encodeEvmDraft,
} from "@binference/plugin-sdk/evm";
import {
  type Address,
  encodeFunctionData,
  getAddress,
  type Hex,
  isAddress,
  parseAbi,
  parseAbiItem,
  zeroAddress,
} from "viem";

// From ERC-8004's reference registry, `IdentityRegistryUpgradeable.sol` 2.0.0 of
// erc-8004/erc-8004-contracts, the implementation BSC's registry runs, and ERC-721, which it extends.
// `register(string agentURI)` mints the next id to `msg.sender`, stores the caller as its
// `agentWallet` and the URI as its token URI. Its `uint256` return is left out: binference reads the
// id from the `Registered` event, and a ceiling declares no outputs.
const registerAbi = parseAbiItem("function register(string agentURI)");
const mintAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
]);

/** `register(string)` as the plugin declares it, so a ceiling holds its rule. */
export const registerCallJson: JsonValue = callAbiJson(registerAbi);

/** The registry on its chain, by its checksum address. */
export interface RegistryAt {
  readonly chain: ChainRef;
  readonly address: Address;
}

// The calldata of `register(string)` with the file.
function registerData(file: string): Hex {
  return encodeFunctionData({ abi: [registerAbi], args: [file] });
}

/**
 * The one call that registers the file from the wallet: `register(string)` on the registry, with
 * no coin. The registry mints the identity to the caller, so the call credits the wallet alone. A
 * wallet of another chain is `erc8004.bad_request`.
 */
export function buildRegistration(
  registry: RegistryAt,
  request: { readonly wallet: AccountRef; readonly file: string },
): TxDraft {
  if (accountRefParts(request.wallet).chain !== registry.chain) {
    throw new BinferenceError({
      code: "erc8004.bad_request",
      message: "A registration names a wallet of the registry's chain.",
    });
  }
  const to = accountRefSchema.parse(`${registry.chain}:${registry.address}`);
  return encodeEvmDraft({ from: request.wallet, to, value: 0n, data: registerData(request.file) });
}

/**
 * Reads a registration call from the draft's bytes alone: only `register(string)` to the registry
 * on its chain, with no coin, in the exact bytes the builder writes. Another function, such as the
 * overloads that take metadata or no URI, a call to another contract, coin, or bytes past the
 * argument are `unknown_call`.
 */
export function decodeRegistration(
  registry: RegistryAt,
  draft: TxDraft,
): Result<DecodedRegistration, "unknown_call"> {
  const evm = decodeEvmDraft(draft);
  const isOwn =
    evm.ok &&
    draft.chain === registry.chain &&
    evm.value.to === registry.address &&
    evm.value.value === 0n;
  const call = evm.ok && isOwn ? decodeCall([registerAbi], evm.value.data) : undefined;
  if (!evm.ok || call?.ok !== true) {
    return err("unknown_call");
  }
  const [file] = call.value.args;
  return registerData(file) === evm.value.data.toLowerCase() ? ok({ file }) : err("unknown_call");
}

// A log's emitter as a checksum address, when it is one.
function emitterOf(emitter: AccountRef): Address | undefined {
  const { address } = accountRefParts(emitter);
  return isAddress(address, { strict: false }) ? getAddress(address) : undefined;
}

/**
 * How many identity tokens of the registry the step minted to the wallet: ERC-721 `Transfer`
 * events the registry emitted from the zero address to the wallet.
 */
export function mintedTo(registry: RegistryAt, step: SimulatedStep, wallet: AccountRef): number {
  const to = getAddress(accountRefParts(wallet).address);
  return (step.logs ?? []).filter((log) => {
    if (emitterOf(log.emitter) !== registry.address) {
      return false;
    }
    const event = decodeLog(mintAbi, log);
    return (
      event?.eventName === "Transfer" &&
      event.args.from === zeroAddress &&
      getAddress(event.args.to) === to
    );
  }).length;
}
