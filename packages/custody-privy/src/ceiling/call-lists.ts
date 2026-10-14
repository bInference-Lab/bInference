import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import type { CeilingCall, CeilingProblem, LaunchCall } from "./ceiling.js";
import { type AbiFunction, abiFunctionJson } from "./policy-rule.js";

/**
 * The calls one rule allows on a chain: one function, the wallet inputs it pins to the signing
 * wallet, and the contracts it may be called on, checksummed, each once.
 */
export interface CallRuleLists {
  readonly abi: AbiFunction;
  readonly walletInputs: readonly string[];
  readonly contracts: readonly string[];
}

// Privy's `in` operator takes at most 100 values, and a rule's name at most 50 characters.
const maxListed = 100;
const maxRuleName = 50;

/** The name of the rule that allows calls of one function on one chain. */
export function callRuleName(functionName: string, chainId: string): string {
  return `Call ${functionName}, chain ${chainId}`;
}

/** The name of the rule that allows a launch wallet's calls of one function on any contract. */
export function launchCallRuleName(functionName: string, chainId: string): string {
  return `Launch call ${functionName}, chain ${chainId}`;
}

// What decides whether two calls of one name fit one rule: the function and its pinned inputs.
function shapeOf(call: LaunchCall): string {
  return JSON.stringify([abiFunctionJson(call.abi), [...call.walletInputs].toSorted()]);
}

// Each pinned input is a top-level address input of the function, named once, and the rule's name
// fits Privy's 50 characters.
function isWellFormed(call: LaunchCall, ruleName: string): boolean {
  const { abi, walletInputs } = call;
  const pinned = walletInputs.every((input) =>
    abi.inputs.some((item) => item.name === input && item.type === "address"),
  );
  const fits = ruleName.length <= maxRuleName;
  return pinned && fits && new Set(walletInputs).size === walletInputs.length;
}

/**
 * The launch call rules of one chain (decision 0217), one per function name in the order first
 * given: a function, and the wallet inputs it pins to the signing wallet, on no fixed contract. A
 * call that pins no input, whose pinned input is no address input or whose rule name passes 50
 * characters, or two calls of one name that differ, is refused.
 */
export function launchListsOf(
  calls: readonly LaunchCall[],
  chainId: string,
): Result<readonly LaunchCall[], CeilingProblem> {
  const grouped = new Map<string, LaunchCall>();
  for (const call of calls) {
    const ruleName = launchCallRuleName(call.abi.name, chainId);
    if (call.walletInputs.length === 0 || !isWellFormed(call, ruleName)) {
      return err("bad_call");
    }
    const held = grouped.get(call.abi.name);
    if (held !== undefined && shapeOf(held) !== shapeOf(call)) {
      return err("clashing_calls");
    }
    grouped.set(call.abi.name, held ?? { abi: call.abi, walletInputs: call.walletInputs });
  }
  return ok([...grouped.values()]);
}

/**
 * The call rules of one chain, one per function name in the order first given: each lists every
 * contract given that function. A malformed contract, a function whose rule name passes 50
 * characters or whose pinned input is no address input, two calls of one name that differ in
 * their function or pinned inputs, or more than 100 contracts for one function, is refused.
 */
export function callListsOf(
  calls: readonly CeilingCall[],
  chainId: string,
): Result<readonly CallRuleLists[], CeilingProblem> {
  const grouped = new Map<
    string,
    { readonly call: CeilingCall; readonly contracts: Set<string> }
  >();
  for (const call of calls) {
    const contract = parseEvmAddress(call.contract);
    if (!contract.ok) {
      return contract;
    }
    if (!isWellFormed(call, callRuleName(call.abi.name, chainId))) {
      return err("bad_call");
    }
    const held = grouped.get(call.abi.name);
    if (held !== undefined && shapeOf(held.call) !== shapeOf(call)) {
      return err("clashing_calls");
    }
    const group = held ?? { call, contracts: new Set<string>() };
    group.contracts.add(contract.value);
    grouped.set(call.abi.name, group);
  }
  const lists = [...grouped.values()].map(({ call, contracts }) => ({
    abi: call.abi,
    walletInputs: call.walletInputs,
    contracts: [...contracts],
  }));
  return lists.some((item) => item.contracts.length > maxListed)
    ? err("too_many_addresses")
    : ok(lists);
}
