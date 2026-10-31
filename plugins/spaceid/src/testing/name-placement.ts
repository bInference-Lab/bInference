import { BinferenceError } from "@binference/plugin-sdk";
import type { RpcFailover } from "@binference/plugin-sdk/evm";
import {
  type Address,
  decodeFunctionResult,
  encodeFunctionData,
  type Hex,
  labelhash,
  namehash,
  parseAbi,
} from "viem";
import { z } from "zod";
import { reverseNameOf } from "./space-id-world.js";

// SPACE ID's functions a fork test reads and writes to place a name: the registry's owners and
// resolvers, the base registrar's owner and controllers, a resolver's address record and a
// reverse resolver's name.
const placementAbi = parseAbi([
  "function owner(bytes32 node) view returns (address)",
  "function resolver(bytes32 node) view returns (address)",
  "function setResolver(bytes32 node, address resolver)",
  "function setSubnodeOwner(bytes32 node, bytes32 label, address owner) returns (bytes32)",
  "function owner() view returns (address)",
  "function addController(address controller)",
  "function register(uint256 id, address owner, uint256 duration) returns (uint256)",
  "function addr(bytes32 node) view returns (address)",
  "function setAddr(bytes32 node, address a)",
  "function setName(bytes32 node, string name)",
]);

/** One transaction a fork test sends from an account it impersonates. */
export interface PlacementStep {
  readonly from: Address;
  readonly to: Address;
  readonly data: Hex;
}

/**
 * SPACE ID's contracts, the accounts that own its `.bnb` and `addr.reverse` nodes, and the
 * resolvers SPACE ID's own name and its address's reverse record use.
 */
export interface PlacementParts {
  readonly registry: Address;
  readonly registrar: Address;
  /** The base registrar's owner, which makes itself a controller to register a name. */
  readonly registrarOwner: Address;
  /** The owner of the `addr.reverse` node, which hands an address its reverse node. */
  readonly reverseOwner: Address;
  readonly publicResolver: Address;
  readonly reverseResolver: Address;
}

const hexSchema = z.templateLiteral(["0x", z.string()]);

type ReadName = "owner" | "resolver" | "addr";

async function readNode(
  read: { readonly rpc: RpcFailover; readonly signal: AbortSignal },
  call: { readonly to: Address; readonly functionName: ReadName; readonly node?: Hex },
): Promise<Address> {
  const { functionName, node } = call;
  const data =
    node === undefined
      ? encodeFunctionData({ abi: placementAbi, functionName: "owner" })
      : encodeFunctionData({ abi: placementAbi, functionName, args: [node] });
  const reply = await read.rpc.request({
    method: "eth_call",
    params: [{ to: call.to, data }, "latest"],
    result: hexSchema,
    signal: read.signal,
  });
  if (reply.kind === "error") {
    throw new BinferenceError({
      code: "spaceid.read_failed",
      message: `${functionName} reverted.`,
    });
  }
  return decodeFunctionResult({ abi: placementAbi, functionName, data: reply.value });
}

/**
 * Reads the {@link PlacementParts} of SPACE ID on a chain at its latest block: the owners from the
 * registry and the base registrar, and the resolvers the registry names for `spaceid.bnb` and for
 * its address's reverse record.
 */
export async function readPlacementParts(
  contracts: { readonly registry: Address; readonly registrar: Address },
  read: { readonly rpc: RpcFailover; readonly signal: AbortSignal },
): Promise<PlacementParts> {
  const { registry, registrar } = contracts;
  const own = namehash("spaceid.bnb");
  const publicResolver = await readNode(read, {
    to: registry,
    functionName: "resolver",
    node: own,
  });
  const spaceIdAddress = await readNode(read, {
    to: publicResolver,
    functionName: "addr",
    node: own,
  });
  const reverseNode = namehash(reverseNameOf(spaceIdAddress));
  const [reverseResolver, registrarOwner, reverseOwner] = await Promise.all([
    readNode(read, { to: registry, functionName: "resolver", node: reverseNode }),
    readNode(read, { to: registrar, functionName: "owner" }),
    readNode(read, { to: registry, functionName: "owner", node: namehash("addr.reverse") }),
  ]);
  return { ...contracts, registrarOwner, reverseOwner, publicResolver, reverseResolver };
}

const year = 31_536_000n;

/**
 * The steps that register `<label>.bnb` to `holder` for a year, name the public resolver for it
 * and point it to `address`, as SPACE ID's own controllers and a name's holder would.
 */
export function registerSteps(
  parts: PlacementParts,
  name: { readonly label: string; readonly holder: Address; readonly address: Address },
): readonly PlacementStep[] {
  const { registry, registrar, registrarOwner, publicResolver } = parts;
  const node = namehash(`${name.label}.bnb`);
  const id = BigInt(labelhash(name.label));
  return [
    {
      from: registrarOwner,
      to: registrar,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "addController",
        args: [registrarOwner],
      }),
    },
    {
      from: registrarOwner,
      to: registrar,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "register",
        args: [id, name.holder, year],
      }),
    },
    {
      from: name.holder,
      to: registry,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "setResolver",
        args: [node, publicResolver],
      }),
    },
    pointStep(parts, { ...name, name: `${name.label}.bnb` }),
  ];
}

/** The step in which a name's holder points it to `address` on the public resolver. */
export function pointStep(
  parts: PlacementParts,
  name: { readonly name: string; readonly holder: Address; readonly address: Address },
): PlacementStep {
  return {
    from: name.holder,
    to: parts.publicResolver,
    data: encodeFunctionData({
      abi: placementAbi,
      functionName: "setAddr",
      args: [namehash(name.name), name.address],
    }),
  };
}

/**
 * The steps that give `address` its reverse node, name the reverse resolver for it and set its
 * name, as the address itself would through SPACE ID's reverse records.
 */
export function reverseSteps(
  parts: PlacementParts,
  reverse: { readonly address: Address; readonly name: string },
): readonly PlacementStep[] {
  const reverseName = reverseNameOf(reverse.address);
  const label = labelhash(reverseName.split(".")[0] ?? "");
  const node = namehash(reverseName);
  return [
    {
      from: parts.reverseOwner,
      to: parts.registry,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "setSubnodeOwner",
        args: [namehash("addr.reverse"), label, reverse.address],
      }),
    },
    {
      from: reverse.address,
      to: parts.registry,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "setResolver",
        args: [node, parts.reverseResolver],
      }),
    },
    {
      from: reverse.address,
      to: parts.reverseResolver,
      data: encodeFunctionData({
        abi: placementAbi,
        functionName: "setName",
        args: [node, reverse.name],
      }),
    },
  ];
}
