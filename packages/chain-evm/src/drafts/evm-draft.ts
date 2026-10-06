import { type AccountRef, accountRefParts, chainRefParts, type TxDraft } from "@binference/chain";
import { BinferenceError, err, ok, type Result } from "@binference/core";
import {
  type Address,
  concat,
  getAddress,
  type Hex,
  hexToBigInt,
  numberToHex,
  size,
  slice,
} from "viem";
import { parseEvmAddress } from "../evm-address.js";
import { evmNamespace } from "../evm-ids.js";

/** An EVM call as a draft carries it. */
export interface EvmDraftCall {
  readonly from: Address;
  readonly to: Address;
  /** Native value in wei. */
  readonly value: bigint;
  readonly data: Hex;
}

/** What {@link encodeEvmDraft} encodes: a call between two accounts of one EVM chain. */
export interface EvmCallRequest {
  readonly from: AccountRef;
  readonly to: AccountRef;
  /** Native value in wei. */
  readonly value: bigint;
  readonly data: Hex;
}

const maxUint256 = 2n ** 256n - 1n;
// Whole bytes in hex; calldata may be empty, a payload never is.
const dataPattern = /^0x(?:[0-9a-fA-F]{2})*$/;
const payloadPattern = /^0x(?:[0-9a-fA-F]{2})+$/;
// The payload's head: the 20-byte address called, then the 32-byte value.
const toBytes = 20;
const headBytes = 52;

function evmAddressOn(account: AccountRef): Address | undefined {
  const { chain, address } = accountRefParts(account);
  const parsed = parseEvmAddress(address);
  return chainRefParts(chain).namespace === evmNamespace && parsed.ok ? parsed.value : undefined;
}

function refuse(problem: string): BinferenceError {
  return new BinferenceError({ code: "chain.bad_draft", message: `The draft ${problem}` });
}

/**
 * Encodes an EVM call as a draft. Its payload is hex: the address called (20 bytes), the value
 * (32 bytes, big-endian) and the calldata. Accounts on two chains, or outside the EVM family, a
 * value outside 0 to 2^256 - 1 and calldata that is not hex bytes are faults.
 */
export function encodeEvmDraft(call: EvmCallRequest): TxDraft {
  const chain = accountRefParts(call.from).chain;
  const to = evmAddressOn(call.to);
  if (evmAddressOn(call.from) === undefined || to === undefined) {
    throw refuse("needs two EVM accounts.");
  }
  if (accountRefParts(call.to).chain !== chain) {
    throw refuse("calls a contract on another chain.");
  }
  if (call.value < 0n || call.value > maxUint256 || !dataPattern.test(call.data)) {
    throw refuse("has a value out of range or calldata that is not hex.");
  }
  const payload = concat([to, numberToHex(call.value, { size: 32 }), call.data]);
  return { chain, from: call.from, payload: payload.toLowerCase() };
}

/**
 * Reads an EVM draft back into its call. A draft of another family, a sender that is not an EVM
 * address, or a payload too short or not hex bytes is an expected failure.
 */
export function decodeEvmDraft(draft: TxDraft): Result<EvmDraftCall, "malformed_draft"> {
  const from = evmAddressOn(draft.from);
  const isOwnChain = accountRefParts(draft.from).chain === draft.chain;
  if (from === undefined || !isOwnChain || !payloadPattern.test(draft.payload)) {
    return err("malformed_draft");
  }
  const payload: Hex = `0x${draft.payload.slice(2).toLowerCase()}`;
  if (size(payload) < headBytes) {
    return err("malformed_draft");
  }
  return ok({
    from,
    to: getAddress(slice(payload, 0, toBytes)),
    value: hexToBigInt(slice(payload, toBytes, headBytes)),
    data: size(payload) === headBytes ? "0x" : slice(payload, headBytes),
  });
}
