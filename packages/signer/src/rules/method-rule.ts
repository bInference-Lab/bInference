import type { RuleView } from "./hard-rule.js";

// EIP-7702 delegation: a transaction of this type sets code on the wallet.
const delegationType = 4;

/**
 * Rule 4: the request is Privy's `eth_signTransaction` for this wallet, `POST` to
 * `<privyApi>/v1/wallets/<id>/rpc`, and the transaction carries no EIP-7702 authorization. No
 * `personal_sign` and no typed data reach this rule: the body is read as `eth_signTransaction`
 * only, and any other method breaks the rule before it.
 */
export function methodHolds(view: RuleView): boolean {
  const { request, wallet } = view.input;
  const { transaction } = view;
  return (
    request.method === "POST" &&
    request.url === `${view.settings.privyApi}/v1/wallets/${wallet.custodyId}/rpc` &&
    !transaction.delegates &&
    transaction.type !== delegationType
  );
}
