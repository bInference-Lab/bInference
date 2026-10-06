import {
  accountRefParts,
  isTxHash,
  type SignatureProblem,
  type SignedTx,
  type SigningScheme,
  type TxHash,
  type UnsignedTx,
} from "@binference/chain";
import { err, ok, type Result } from "@binference/core";
import { type Hex, keccak256, serializeTransaction } from "viem";
import { parseEvmAddress } from "../evm-address.js";
import type { EvmChain } from "../evm-chain.js";
import { evmFamilyId } from "../evm-ids.js";
import {
  decodeEvmTransaction,
  encodeEvmTransaction,
  type EvmTransaction,
  isHexPayload,
  parseSerialized,
} from "./evm-transaction.js";
import { recoverSigner } from "./recover-signer.js";

/**
 * The EVM signing scheme: it builds the bytes a sender signs, hashes them, and checks a signed
 * transaction against them. It holds no key; signing happens in the signer and in custody.
 */
export interface EvmSigningScheme extends SigningScheme {
  /** Encodes a transaction as the unsigned payload a signer signs. */
  build(chain: EvmChain, tx: EvmTransaction): UnsignedTx;
  /** The 32-byte hash the sender's key signs for this transaction. */
  signingHash(unsigned: UnsignedTx): Result<Hex, "malformed_transaction">;
}

interface SignedParts {
  readonly raw: Hex;
  /** The bytes the signature covers: the transaction re-encoded without its signature. */
  readonly unsignedBytes: Hex;
  readonly r: Hex;
  readonly s: Hex;
  readonly yParity: number;
}

// The signed transaction split into the bytes that were signed and the signature over them.
function splitSigned(raw: string): Result<SignedParts, SignatureProblem> {
  const parsed = parseSerialized(raw);
  if (!isHexPayload(raw) || parsed === undefined) {
    return err("malformed_signature");
  }
  if (parsed.type !== "eip1559") {
    return err("other_transaction");
  }
  if (parsed.r === undefined || parsed.s === undefined || parsed.yParity === undefined) {
    return err("malformed_signature");
  }
  const { r, s, yParity } = parsed;
  const unsignedBytes = serializeTransaction({
    ...parsed,
    r: undefined,
    s: undefined,
    v: undefined,
    yParity: undefined,
  });
  return ok({ raw, unsignedBytes, r, s, yParity });
}

function verify(unsigned: UnsignedTx, signed: SignedTx): Result<TxHash, SignatureProblem> {
  const parts = splitSigned(signed.raw);
  if (!parts.ok) {
    return parts;
  }
  if (signed.chain !== unsigned.chain || parts.value.unsignedBytes !== unsigned.payload) {
    return err("other_transaction");
  }
  const signer = recoverSigner(keccak256(parts.value.unsignedBytes), parts.value);
  if (!signer.ok) {
    return signer;
  }
  const sender = parseEvmAddress(accountRefParts(unsigned.from).address);
  if (!sender.ok || signer.value !== sender.value) {
    return err("other_signer");
  }
  const hash = keccak256(parts.value.raw);
  return isTxHash(hash) ? ok(hash) : err("malformed_signature");
}

/** Creates the EVM signing scheme. */
export function createEvmSigningScheme(): EvmSigningScheme {
  return {
    family: evmFamilyId,
    build: encodeEvmTransaction,
    signingHash(unsigned) {
      const decoded = decodeEvmTransaction(unsigned);
      return decoded.ok && isHexPayload(unsigned.payload)
        ? ok(keccak256(unsigned.payload))
        : err("malformed_transaction");
    },
    verify,
  };
}
