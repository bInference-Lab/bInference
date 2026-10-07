import { type AccountRef, accountRefParts } from "./caip/account-ref.js";
import type { ChainFamily } from "./ports.js";

/**
 * Whether two accounts are one: they share a chain and the family reads one canonical address
 * from both, so `0xabc…` and `0xAbC…` match. An address the family cannot read matches nothing.
 */
export function isSameAccount(left: AccountRef, right: AccountRef, family: ChainFamily): boolean {
  const [one, two] = [accountRefParts(left), accountRefParts(right)];
  const [first, second] = [family.parseAddress(one.address), family.parseAddress(two.address)];
  return one.chain === two.chain && first.ok && second.ok && first.value === second.value;
}
