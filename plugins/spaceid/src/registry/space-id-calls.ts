import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  hexToBigInt,
  parseAbi,
} from "viem";

// The registry, base registrar and resolver calls a resolution makes: the registry's
// `resolver(node)` (EIP-137), the base registrar's `nameExpires(id)`, a resolver's `addr(node)`
// (EIP-137) and a reverse resolver's `name(node)` (EIP-181).
const registryAbi = parseAbi(["function resolver(bytes32 node) view returns (address)"]);
const registrarAbi = parseAbi(["function nameExpires(uint256 id) view returns (uint256)"]);
const addressAbi = parseAbi(["function addr(bytes32 node) view returns (address)"]);
const nameAbi = parseAbi(["function name(bytes32 node) view returns (string)"]);

/** The calldata of the registry's `resolver(node)`. */
export function resolverCallData(node: Hex): Hex {
  return encodeFunctionData({ abi: registryAbi, functionName: "resolver", args: [node] });
}

/** The address the registry's `resolver(node)` answered, checksummed. */
export function resolverOf(data: Hex): Address {
  return decodeFunctionResult({ abi: registryAbi, functionName: "resolver", data });
}

/** The calldata of the base registrar's `nameExpires(id)` for a second-level label's hash. */
export function expiryCallData(registration: Hex): Hex {
  return encodeFunctionData({
    abi: registrarAbi,
    functionName: "nameExpires",
    args: [hexToBigInt(registration)],
  });
}

/** When the registration ends, in seconds since the epoch: 0 for a label never registered. */
export function expiryOf(data: Hex): bigint {
  return decodeFunctionResult({ abi: registrarAbi, functionName: "nameExpires", data });
}

/** The calldata of a resolver's `addr(node)`. */
export function addressCallData(node: Hex): Hex {
  return encodeFunctionData({ abi: addressAbi, functionName: "addr", args: [node] });
}

/** The address record a resolver's `addr(node)` answered, checksummed. */
export function addressOf(data: Hex): Address {
  return decodeFunctionResult({ abi: addressAbi, functionName: "addr", data });
}

/** The calldata of a reverse resolver's `name(node)`. */
export function nameCallData(node: Hex): Hex {
  return encodeFunctionData({ abi: nameAbi, functionName: "name", args: [node] });
}

/** The name a reverse resolver's `name(node)` answered. */
export function nameOf(data: Hex): string {
  return decodeFunctionResult({ abi: nameAbi, functionName: "name", data });
}
