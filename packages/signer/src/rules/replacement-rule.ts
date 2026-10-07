import { isAccount, type RuleView } from "./hard-rule.js";

/**
 * Rule 6: a transaction that takes the nonce of one signed before is at that nonce, and is either
 * a speed-up, the same call (`to`, value and calldata) as the original, or a cancel, a 0-value
 * transfer with no calldata to the wallet itself.
 */
export function replacementHolds(view: RuleView): boolean {
  const { replaces, chain } = view.input.step;
  const { transaction } = view;
  if (replaces === undefined) {
    return true;
  }
  if (transaction.nonce !== BigInt(replaces.nonce)) {
    return false;
  }
  if (replaces.kind === "cancel") {
    return (
      isAccount(view.input.wallet.account, chain, transaction.to) &&
      transaction.value === 0n &&
      transaction.data === "0x"
    );
  }
  const { original } = replaces;
  return (
    isAccount(original.to, chain, transaction.to) &&
    transaction.value === original.value &&
    transaction.data === original.data.toLowerCase()
  );
}
