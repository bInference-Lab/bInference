/**
 * What an EVM call does to tokens, read from its calldata alone: an ERC-20 `approve`,
 * `increaseAllowance`, `transfer` or `transferFrom`, an ERC-721 or ERC-1155
 * `setApprovalForAll`, Permit2's `approve`, or anything else. Addresses are lowercase hex.
 */
export type TokenCall =
  | { readonly kind: "approve"; readonly spender: string; readonly amount: bigint }
  | { readonly kind: "transfer"; readonly recipient: string; readonly amount: bigint }
  | { readonly kind: "otherTokenCall" }
  | { readonly kind: "notTokenCall" };

const selectorChars = 8;
const wordChars = 64;
const addressPadding = "0".repeat(24);

// Selectors, checked against viem's toFunctionSelector.
const approveSelector = "095ea7b3";
const transferSelector = "a9059cbb";
const otherTokenSelectors = new Set([
  "23b872dd", // transferFrom(address,address,uint256)
  "39509351", // increaseAllowance(address,uint256)
  "a22cb465", // setApprovalForAll(address,bool)
  "87517c45", // Permit2 approve(address,address,uint160,uint48)
]);

function addressWord(word: string): string | undefined {
  return word.startsWith(addressPadding) ? `0x${word.slice(addressPadding.length)}` : undefined;
}

// An (address, uint256) call is exactly a selector and two words, the address padded with zeros,
// as Solidity's own decoder demands.
function addressAndAmount(
  hex: string,
): { readonly account: string; readonly amount: bigint } | undefined {
  if (hex.length !== selectorChars + 2 * wordChars) {
    return undefined;
  }
  const account = addressWord(hex.slice(selectorChars, selectorChars + wordChars));
  return account === undefined
    ? undefined
    : { account, amount: BigInt(`0x${hex.slice(selectorChars + wordChars)}`) };
}

/**
 * Reads what a call does to tokens. `data` is `0x` and lowercase hex. An `approve` or `transfer`
 * whose arguments do not read exactly counts as another token call, which no step plans.
 */
export function readTokenCall(data: string): TokenCall {
  const hex = data.slice(2);
  const selector = hex.slice(0, selectorChars);
  if (selector === approveSelector || selector === transferSelector) {
    const call = addressAndAmount(hex);
    if (call === undefined) {
      return { kind: "otherTokenCall" };
    }
    return selector === approveSelector
      ? { kind: "approve", spender: call.account, amount: call.amount }
      : { kind: "transfer", recipient: call.account, amount: call.amount };
  }
  return otherTokenSelectors.has(selector) ? { kind: "otherTokenCall" } : { kind: "notTokenCall" };
}
