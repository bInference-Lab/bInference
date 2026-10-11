import type { RuleView } from "./hard-rule.js";

// EIP-7702 delegation: a transaction of this type sets code on the wallet.
const delegationType = 4;
// Custody asks Privy to drop a request it has not handled within 5 minutes; no signature lasts
// longer.
const maxExpiryMs = 5 * 60_000;

// The request carries Privy's expiry, at most 5 minutes from now.
function expiresSoon(view: RuleView): boolean {
  const expiry = view.input.request.headers["privy-request-expiry"];
  return expiry !== undefined && BigInt(expiry) <= BigInt(view.nowMs + maxExpiryMs);
}

/**
 * Rule 4: the request is Privy's `eth_signTransaction` for this wallet, `POST` to
 * `<privyApi>/v1/wallets/<id>/rpc`, with a `privy-request-expiry` at most 5 minutes from now, and
 * the transaction carries no EIP-7702 authorization. No
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
    transaction.type !== delegationType &&
    expiresSoon(view)
  );
}
