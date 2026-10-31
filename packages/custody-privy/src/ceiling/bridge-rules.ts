import { err, ok, type Result } from "@binference/core";
import { addressList } from "./address-list.js";
import type { BridgeRoute, BridgeTarget, CeilingProblem } from "./ceiling.js";
import {
  type AbiFunction,
  allow,
  noValue,
  onCalldata,
  onTransaction,
  type PolicyRule,
  walletAddress,
} from "./policy-rule.js";

// Privy's rule names hold at most 50 characters.
const maxRuleName = 50;
const decimalId = /^[1-9]\d{0,19}$/;

// The name of the rule that allows one route of a bridge deposit, counted from 1.
function bridgeRuleName(
  functionName: string,
  place: { readonly chainId: string; readonly destination: string; readonly route: number },
): string {
  const { chainId, destination, route } = place;
  return `Bridge ${functionName}, chain ${chainId} to ${destination}, ${String(route)}`;
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

// A target's routes, each token checksummed and each pair once; none is `bad_bridge`.
function routesOf(routes: readonly BridgeRoute[]): Result<readonly BridgeRoute[], CeilingProblem> {
  const pairs: BridgeRoute[] = [];
  for (const route of routes) {
    const tokens = addressList([route.tokenIn, route.tokenOut]);
    if (!tokens.ok) {
      return tokens;
    }
    const [tokenIn = "", tokenOut = tokenIn] = tokens.value;
    if (!pairs.some((pair) => pair.tokenIn === tokenIn && pair.tokenOut === tokenOut)) {
      pairs.push({ tokenIn, tokenOut });
    }
  }
  return pairs.length === 0 ? err("bad_bridge") : ok(pairs);
}

// A target's contract, recipients and routes, each checksummed and none empty.
function listsOf(target: BridgeTarget): Result<BridgeTarget, CeilingProblem> {
  const contract = addressList([target.call.contract]);
  const recipients = addressList(target.recipients);
  const routes = routesOf(target.routes);
  if (!recipients.ok) {
    return recipients;
  }
  if (!routes.ok) {
    return routes;
  }
  if (!contract.ok || recipients.value.length === 0) {
    return err(contract.ok ? "bad_bridge" : contract.error);
  }
  const call = { ...target.call, contract: contract.value[0] ?? target.call.contract };
  return ok({ ...target, call, recipients: recipients.value, routes: routes.value });
}

function checkedTarget(
  target: BridgeTarget,
  chainId: string,
): Result<BridgeTarget, CeilingProblem> {
  const destination = target.destinationChainId;
  const longest = { chainId, destination, route: target.routes.length };
  const fits =
    decimalId.test(destination) &&
    bridgeRuleName(target.call.abi.name, longest).length <= maxRuleName;
  return fits && inputsFit(target) ? listsOf(target) : err("bad_bridge");
}

/**
 * The bridge targets of one chain, checked (decision 0302): each target's inputs are top-level
 * inputs of its function with the types they need, one of them pinned to the wallet, its rule
 * names fit Privy's 50 characters, it names one recipient and one route at least, its addresses
 * are checksummed, and no function names a destination twice. Anything else is refused.
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
  const destinations = checked.map(
    (target) => `${target.call.abi.name} ${target.destinationChainId}`,
  );
  return new Set(destinations).size === destinations.length ? ok(checked) : err("bad_bridge");
}

/**
 * The rules that allow a bridge deposit from a chain to one destination (decision 0302), one per
 * route: the function on its contract with no native coin, each pinned input the signing wallet,
 * the recipient one of the addresses saved for the destination, the destination chain's id in
 * decimal, which Privy matches as a number, and the route's token that leaves with the token that
 * arrives. The chain id and the recipient sit in one rule, so an address saved for one chain is
 * never paid on another, and the tokens sit in pairs, so no route is mixed with another.
 */
export function bridgeRules(target: BridgeTarget, chainId: string): readonly PolicyRule[] {
  const { abi, contract, walletInputs, bridge } = target.call;
  const field = (input: string) => `${abi.name}.${input}`;
  const destination = target.destinationChainId;
  return target.routes.map((route, index) =>
    allow(bridgeRuleName(abi.name, { chainId, destination, route: index + 1 }), [
      onTransaction("chain_id", "eq", chainId),
      onTransaction("to", "in", [contract]),
      onTransaction("value", "lte", noValue),
      onCalldata(abi, "function_name", abi.name),
      ...walletInputs.map((input) => onCalldata(abi, field(input), walletAddress)),
      onCalldata(abi, field(bridge.recipient), target.recipients),
      onCalldata(abi, field(bridge.destinationChain), destination),
      onCalldata(abi, field(bridge.tokenIn), route.tokenIn),
      onCalldata(abi, field(bridge.tokenOut), route.tokenOut),
    ]),
  );
}
