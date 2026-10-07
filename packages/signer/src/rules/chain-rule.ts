import { accountRefParts, chainRefParts } from "@binference/chain";
import type { RuleView } from "./hard-rule.js";

// Privy's eth_signTransaction signs EVM transactions, whose chains are CAIP-2 `eip155` ids with
// the decimal chain id as the reference.
const evmNamespace = "eip155";

/**
 * Rule 1: the step's chain is enabled, it is the chain the transaction names, and the wallet's
 * account is on it.
 */
export function chainHolds(view: RuleView): boolean {
  const { step, wallet } = view.input;
  const { namespace, reference } = chainRefParts(step.chain);
  return (
    view.settings.chains.includes(step.chain) &&
    namespace === evmNamespace &&
    view.transaction.chainId?.toString() === reference &&
    accountRefParts(wallet.account).chain === step.chain
  );
}
