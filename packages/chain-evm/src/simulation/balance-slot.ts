import {
  type Address,
  encodeAbiParameters,
  encodeFunctionData,
  erc20Abi,
  type Hex,
  hexToBigInt,
  keccak256,
  toHex,
} from "viem";
import type { RpcFailover } from "../rpc/rpc-call.js";
import { simulationReplySchema } from "./simulation-reply.schema.js";

/** The token and holder whose balance slot to find. */
export interface BalanceSlotRequest {
  readonly token: Address;
  readonly holder: Address;
  readonly signal: AbortSignal;
}

// How many of a token's own storage slots may hold its balances mapping. Upgradeable tokens of
// OpenZeppelin's 4.x line put it past 50 reserved slots per parent contract, so this covers a token
// with three such parents.
const slotIndexes = 200;

// ERC-7201's namespace of OpenZeppelin's upgradeable ERC-20 5.x, whose first field is the balances.
const openZeppelinErc20Namespace = "openzeppelin.storage.ERC20";

// Each candidate slot gets its own marker: what balanceOf answers names the slot it read.
const markerBase = 1n << 254n;
// One ABI word as hex: `0x` and 64 digits.
const wordLength = 66;

/**
 * The storage location of an ERC-7201 namespace: `keccak256(abi.encode(uint256(keccak256(id)) -
 * 1)) & ~bytes32(uint256(0xff))`.
 */
export function erc7201Location(namespace: string): Hex {
  const inner = hexToBigInt(keccak256(toHex(namespace))) - 1n;
  const outer = hexToBigInt(keccak256(encodeAbiParameters([{ type: "uint256" }], [inner])));
  return toHex(outer & ~0xffn, { size: 32 });
}

/**
 * Where a token may keep `holder`'s balance: a Solidity mapping at each of its first slots
 * (`keccak256(holder . slot)`), a Vyper mapping at each (`keccak256(slot . holder)`), and
 * OpenZeppelin's namespaced ERC-20 storage.
 */
export function balanceSlotCandidates(holder: Address): readonly Hex[] {
  const indexes = Array.from({ length: slotIndexes }, (_, index) => BigInt(index));
  const solidity = indexes.map((index) =>
    keccak256(encodeAbiParameters([{ type: "address" }, { type: "uint256" }], [holder, index])),
  );
  const vyper = indexes.map((index) =>
    keccak256(encodeAbiParameters([{ type: "uint256" }, { type: "address" }], [index, holder])),
  );
  const namespaced = keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes32" }],
      [holder, erc7201Location(openZeppelinErc20Namespace)],
    ),
  );
  return [...solidity, ...vyper, namespaced];
}

function markerOf(index: number): bigint {
  return markerBase + BigInt(index);
}

/**
 * Finds the storage slot a token keeps `holder`'s balance in, so a simulation can set that balance
 * with a state override (the `stateDiff` of `eth_simulateV1`). It runs `balanceOf(holder)` once
 * with every candidate slot set to its own marker, and takes the slot whose marker comes back
 * exactly. A token that computes its balances (a reflection or rebasing token), packs them with
 * other fields or keeps them anywhere else, and a node that refuses the probe as a call, give
 * `undefined`: no slot is set rather than a guessed one. When no node answers, it rejects as the
 * simulation does.
 */
export async function findBalanceSlot(
  rpc: RpcFailover,
  request: BalanceSlotRequest,
): Promise<Hex | undefined> {
  const { token, holder, signal } = request;
  const candidates = balanceSlotCandidates(holder);
  const stateDiff = Object.fromEntries(
    candidates.map((slot, index) => [slot, toHex(markerOf(index), { size: 32 })]),
  );
  const byMarker = new Map(candidates.map((slot, index) => [markerOf(index), slot]));
  const data = encodeFunctionData({ abi: erc20Abi, functionName: "balanceOf", args: [holder] });
  const reply = await rpc.request({
    method: "eth_simulateV1",
    params: [
      {
        blockStateCalls: [
          {
            stateOverrides: { [token]: { stateDiff } },
            calls: [{ from: holder, to: token, data }],
          },
        ],
        validation: false,
      },
      "latest",
    ],
    result: simulationReplySchema,
    signal,
  });
  const call = reply.kind === "result" ? reply.value[0]?.calls[0] : undefined;
  return call?.status === 1n && call.returnData.length === wordLength
    ? byMarker.get(hexToBigInt(call.returnData))
    : undefined;
}
