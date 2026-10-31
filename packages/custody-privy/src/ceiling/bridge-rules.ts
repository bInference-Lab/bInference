import { err, ok, type Result } from "@binference/core";
import { addressList } from "./address-list.js";
import type { BridgeTarget, CeilingProblem } from "./ceiling.js";
import type { AbiFunction, PolicyRule } from "./policy-rule.js";
import { allow, noValue, onCalldata, onTransaction, walletAddress } from "./rule-parts.js";

// Privy's rule names hold at most 50 characters.
const maxRuleName = 50;
const decimalId = /^[1-9]\d{0,19}$/;

// The name of the rule that allows a bridge deposit from one chain to one destination.
function bridgeRuleName(functionName: string, chainId: string, destination: string): string {
  return `Bridge ${functionName}, chain ${chainId} to ${destination}`;
}

// The type of a top-level input of the function, by name; undefined for none.
function typeOf(abi: AbiFunction, input: string): string | undefined {
  return abi.inputs.find((item) => item.name === input)?.type;
}

// Every bound input is a top-level input of its type: the recipient, the tokens and each pin an
// address, the destination a uint256. One input at least is pinned to the wallet: the depositor,
// whom the bridge refunds (decision 0297).
function inputsFit(target: BridgeTarget): boolean {
  const { abi, walletInputs, bridge } = target.call;
  const addresses = [bridge.recipient, bridge.tokenIn, bridge.tokenOut, ...walletInputs];
  return (
    walletInputs.length > 0 &&
    addresses.every((input) => typeOf(abi, input) === "address") &&
    typeOf(abi, bridge.destinationChain) === "uint256" &&
    new Set([...addresses, bridge.destinationChain]).size === addresses.length + 1
  );
}

// One of a target's lists, checksummed; an empty list is `bad_bridge`.
function listed(addresses: readonly string[]): Result<readonly string[], CeilingProblem> {
  const list = addressList(addresses);
  if (!list.ok) {
    return list;
  }
  return list.value.length === 0 ? err("bad_bridge") : list;
}

// A target's contract, recipients and tokens, each checksummed and none empty.
function listsOf(target: BridgeTarget): Result<BridgeTarget, CeilingProblem> {
  const contract = listed([target.call.contract]);
  const recipients = listed(target.recipients);
  const tokensIn = listed(target.tokensIn);
  const tokensOut = listed(target.tokensOut);
  const failed = [recipients, contract, tokensIn, tokensOut].find((list) => !list.ok);
  if (failed !== undefined && !failed.ok) {
    return failed;
  }
  if (!contract.ok || !recipients.ok || !tokensIn.ok || !tokensOut.ok) {
    return err("malformed_address");
  }
  return ok({
    ...target,
    call: { ...target.call, contract: contract.value[0] ?? target.call.contract },
    recipients: recipients.value,
    tokensIn: tokensIn.value,
    tokensOut: tokensOut.value,
  });
}

function checkedTarget(
  target: BridgeTarget,
  chainId: string,
): Result<BridgeTarget, CeilingProblem> {
  const name = bridgeRuleName(target.call.abi.name, chainId, target.destinationChainId);
  const fits = decimalId.test(target.destinationChainId) && name.length <= maxRuleName;
  return fits && inputsFit(target) ? listsOf(target) : err("bad_bridge");
}

/**
 * The bridge targets of one chain, checked (decision 0302): each target's inputs are top-level inputs
 * of its function with the types they need, one of them pinned to the wallet, its rule name fits
 * Privy's 50 characters, it names one recipient and one token each way at least, its addresses are checksummed, and no function
 * names a destination twice. Anything else is refused.
 */
export function checkedTargets(
  targets: readonly BridgeTarget[],
  chainId: string,
): Result<readonly BridgeTarget[], CeilingProblem> {
  const checked: BridgeTarget[] = [];
  for (const target of targets) {
    const one = checkedTarget(target, chainId);
    if (!one.ok) {
      return one;
    }
    checked.push(one.value);
  }
  const names = checked.map((target) =>
    bridgeRuleName(target.call.abi.name, chainId, target.destinationChainId),
  );
  return new Set(names).size === names.length ? ok(checked) : err("bad_bridge");
}

/**
 * The rule that allows a bridge deposit from a chain to one destination (decision 0302): the
 * function on its contract with no native coin, each pinned input the signing wallet, the
 * recipient one of the addresses saved for the destination, the destination chain's id in decimal,
 * which Privy matches as a number, and the token that leaves and the token that arrives among the
 * routes' tokens. The chain id and the recipient sit in one rule, so an address saved for one chain
 * is never paid on another.
 */
export function bridgeRule(target: BridgeTarget, chainId: string): PolicyRule {
  const { abi, contract, walletInputs, bridge } = target.call;
  const field = (input: string) => `${abi.name}.${input}`;
  return allow(bridgeRuleName(abi.name, chainId, target.destinationChainId), [
    onTransaction("chain_id", "eq", chainId),
    onTransaction("to", "in", [contract]),
    onTransaction("value", "lte", noValue),
    onCalldata(abi, "function_name", abi.name),
    ...walletInputs.map((input) => onCalldata(abi, field(input), walletAddress)),
    onCalldata(abi, field(bridge.recipient), target.recipients),
    onCalldata(abi, field(bridge.destinationChain), target.destinationChainId),
    onCalldata(abi, field(bridge.tokenIn), target.tokensIn),
    onCalldata(abi, field(bridge.tokenOut), target.tokensOut),
  ]);
}
