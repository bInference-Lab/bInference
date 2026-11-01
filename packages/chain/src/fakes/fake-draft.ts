import type { Amount } from "../amount.js";
import { type AccountRef, accountRefParts } from "../caip/account-ref.js";
import { parseAssetRef } from "../caip/asset-ref.js";
import type { TxDraft } from "../transaction.js";

/** A call of the fake family: the address it goes to, the native coin it sends and its data. */
export interface FakeCall {
  /** An address of the fake family: `0x` and 8 hex digits. */
  readonly to: string;
  readonly value: bigint;
  /** Comma-separated words without a `|`, such as `approve,0x0000000b,5`. */
  readonly data: string;
}

const addressPattern = /^0x[0-9a-fA-F]{8}$/;
const unsignedPattern = /^(?:0|[1-9]\d{0,77})$/;

/** Whether a text is an address of the fake family. */
export function isFakeAddress(text: string): boolean {
  return addressPattern.test(text);
}

/** Whether a text is an unsigned integer in decimal, as fake drafts write amounts. */
export function isFakeUnsigned(text: string): boolean {
  return unsignedPattern.test(text);
}

/** Encodes a call of the fake family as a draft from an account, for tests. */
export function fakeDraft(from: AccountRef, call: FakeCall): TxDraft {
  return {
    chain: accountRefParts(from).chain,
    from,
    payload: [call.to, call.value.toString(), call.data].join("|"),
  };
}

/** Reads a fake draft's call back. A payload of any other shape is undefined. */
export function fakeCallOf(draft: TxDraft): FakeCall | undefined {
  const [to = "", value = "", data, ...rest] = draft.payload.split("|");
  if (data === undefined || rest.length > 0 || !isFakeAddress(to) || !isFakeUnsigned(value)) {
    return undefined;
  }
  return { to, value: BigInt(value), data };
}

/** The data of a fake token approval: `spender` may spend `amountBase` of the token called. */
export function fakeApprovalData(spender: string, amountBase: bigint): string {
  return ["approve", spender, amountBase.toString()].join(",");
}

/** An amount from a fake call's words: its base units in decimal and its asset. */
export function fakeAmountOf(base: string, asset: string): Amount | undefined {
  const parsed = parseAssetRef(asset);
  return parsed.ok && isFakeUnsigned(base)
    ? { asset: parsed.value, base: BigInt(base) }
    : undefined;
}

/**
 * The amount in and the least out of a fake call's words after its kind: the account it pays, the
 * base units and asset in, then the base units and asset out. Words of any other shape are
 * undefined.
 */
export function fakeAmountsOf(
  words: readonly string[],
): { readonly amountIn: Amount; readonly minOut: Amount } | undefined {
  const [, inBase = "", inAsset = "", outBase = "", outAsset = ""] = words;
  const amountIn = fakeAmountOf(inBase, inAsset);
  const minOut = fakeAmountOf(outBase, outAsset);
  return amountIn === undefined || minOut === undefined ? undefined : { amountIn, minOut };
}
