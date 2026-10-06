import type { Brand } from "@binference/core";
import { z } from "zod";
import { type AccountRef, accountRefSchema } from "./caip/account-ref.js";
import { type ChainRef, chainRefSchema } from "./caip/chain-ref.js";

/** A transaction's hash as its chain shows it. */
export type TxHash = Brand<string, "TxHash">;

const txHashPattern = /^[-.%a-zA-Z0-9]{1,128}$/;

/** Whether a text fits the id grammar every family's transaction hash fits. */
export function isTxHash(text: string): text is TxHash {
  return txHashPattern.test(text);
}

/** A transaction before signing, built by its chain's family. */
export interface UnsignedTx {
  readonly chain: ChainRef;
  /** The account that signs and pays. */
  readonly from: AccountRef;
  /** The family's own encoding of the transaction; code outside the family never reads it. */
  readonly payload: string;
}

/**
 * A transaction as a venue builds it, before the wallet queue gives it its place and its fees (an
 * EVM nonce and gas price). The simulation and the venue host read it; the wallet queue turns it
 * into an {@link UnsignedTx}.
 */
export interface TxDraft {
  readonly chain: ChainRef;
  /** The account that signs and pays: the agent's own wallet. */
  readonly from: AccountRef;
  /** The family's own encoding of the call; code outside the family never reads it. */
  readonly payload: string;
}

/** A {@link TxDraft} as JSON carries it. */
export interface TxDraftWire {
  readonly chain: string;
  readonly from: string;
  readonly payload: string;
}

/** Parses a {@link TxDraft}: CAIP ids and a payload that is not empty. */
export const txDraftSchema: z.ZodType<TxDraft, TxDraftWire> = z.strictObject({
  chain: chainRefSchema,
  from: accountRefSchema,
  payload: z.string().min(1),
});

/** A signed transaction, as the family broadcasts it. */
export interface SignedTx {
  readonly chain: ChainRef;
  /** The signed bytes in the family's own encoding. */
  readonly raw: string;
}

/** Why a signed transaction does not match what was asked to be signed. */
export type SignatureProblem = "malformed_signature" | "other_transaction" | "other_signer";
