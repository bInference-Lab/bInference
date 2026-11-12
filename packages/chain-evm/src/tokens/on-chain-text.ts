import { replaceNul } from "@binference/core";

const nul = "\u0000";

/**
 * Text a contract answered or logged, such as a token's symbol or name, with its trailing zero
 * bytes dropped, the padding of a `bytes32`, and U+FFFD in place of each U+0000 left inside it
 * (decision 0416): no store meets U+0000, and none of its other characters change.
 */
export function onChainText(text: string): string {
  let end = text.length;
  while (text.endsWith(nul, end)) {
    end -= 1;
  }
  return replaceNul(text.slice(0, end));
}
