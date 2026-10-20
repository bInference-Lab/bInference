import type { JsonValue } from "@binference/core";
import { ruleTexts } from "../wallets/policy-rules.schema.js";
import { addressList, type CeilingChainLists, ceilingRules } from "./build-ceiling.js";
import { type CallRuleLists, launchListsOf } from "./call-lists.js";
import type { ChainCaps } from "./ceiling.js";
import {
  callIn,
  capsIn,
  type HeldRule,
  heldRules,
  quantityOf,
  valuesOf,
} from "./held-rules.schema.js";
import { policyRuleJson } from "./policy-rule.js";

/** The 24-hour caps a ceiling names on one chain whose rules allow calls. */
export interface HeldCaps {
  /** The EIP-155 chain id as decimal text. */
  readonly chainId: string;
  readonly caps: ChainCaps;
}

/** A ceiling as Privy holds it now, read from its rules. Addresses are as the rules list them. */
export interface CeilingHeld {
  /** The EIP-155 id of each chain the ceiling names, in the order its rules name them. */
  readonly chainIds: readonly string[];
  /** The contracts a call may reach, each once. */
  readonly contracts: readonly string[];
  /**
   * The most native coin, in base units, one contract call may send on the first chain that
   * allows calls; 0 when no chain does.
   */
  readonly perTxNativeCapBase: bigint;
  /** Every address a native send may pay, each once. */
  readonly recipients: readonly string[];
  /** The caps of each chain whose rules allow calls, in the order the rules name the chains. */
  readonly caps: readonly HeldCaps[];
  /** Whether it is a launch wallet's ceiling: one of its rules is a launch rule (decision 0217). */
  readonly isLaunch: boolean;
  /**
   * The functions its launch rules let a call reach on any contract, each once: each launch call,
   * and `approve` when it allows approvals of any spender (decision 0218). None for an agent wallet.
   */
  readonly launchCalls: readonly string[];
  /**
   * The functions its call rules let a call reach on their contracts, each once, on any chain: a
   * change of them is a change of what the ceiling allows (decision 0271).
   */
  readonly functions: readonly string[];
}

const onChain = /, chain (\d{1,10})$/;
const callPrefix = "Call ";
const launchCallPrefix = "Launch call ";

// The function a launch rule lets a call reach on any contract: a launch call's, or `approve`.
function launchFunctionOf(rule: HeldRule): readonly string[] {
  if (isCallRule(rule, undefined, launchCallPrefix)) {
    return [rule.name.slice(launchCallPrefix.length).replace(onChain, "")];
  }
  return rule.name.startsWith("Launch approvals, ") ? ["approve"] : [];
}

function isCallRule(rule: HeldRule, chainId?: string, prefix = callPrefix): boolean {
  const suffix =
    chainId === undefined ? onChain.test(rule.name) : rule.name.endsWith(`, chain ${chainId}`);
  return rule.name.startsWith(prefix) && suffix;
}

// A rule only a launch wallet's ceiling holds: a launch call, or the approval of any spender.
function isLaunchRule(rule: HeldRule): boolean {
  return (
    isCallRule(rule, undefined, launchCallPrefix) || rule.name.startsWith("Launch approvals, ")
  );
}

function namedRule(read: readonly HeldRule[], kind: string, chainId: string): HeldRule | undefined {
  return read.find((rule) => rule.name === `${kind}, chain ${chainId}`);
}

function chainIdsOf(read: readonly HeldRule[]): readonly string[] {
  return [...new Set(read.flatMap((rule) => onChain.exec(rule.name)?.slice(1, 2) ?? []))];
}

// The cap per call of a chain's first call rule: 0 for none, undefined when it is no quantity.
function capOf(calls: readonly HeldRule[]): bigint | undefined {
  const [first] = calls;
  return first === undefined ? 0n : quantityOf(valuesOf(first, "value", "lte")[0]);
}

// The caps of a chain: the native one its first call rule names, and the approval rule's.
function capsOf(calls: readonly HeldRule[], approvals: HeldRule | undefined) {
  const [first] = calls;
  const native = first === undefined ? [] : capsIn(first);
  const approved = approvals === undefined ? [] : capsIn(approvals);
  if (native === undefined || approved === undefined || native.length > 1) {
    return undefined;
  }
  const [nativeCap] = native;
  return nativeCap === undefined
    ? { approvals: approved }
    : { native: nativeCap, approvals: approved };
}

// One call rule's function, pins and contracts, checksummed; undefined when it cannot be read.
function checkedCall(rule: HeldRule): CallRuleLists | undefined {
  const call = callIn(rule);
  const contracts = call === undefined ? undefined : addressList(call.contracts);
  return call !== undefined && contracts?.ok === true
    ? { ...call, contracts: contracts.value }
    : undefined;
}

// A chain's rules that let a call reach a contract: its call rules, then a launch wallet's launch
// call rules. Each carries the cap per call and the native 24-hour cap.
function anyCallRules(read: readonly HeldRule[], chainId?: string): readonly HeldRule[] {
  return [
    ...read.filter((rule) => isCallRule(rule, chainId)),
    ...read.filter((rule) => isCallRule(rule, chainId, launchCallPrefix)),
  ];
}

// A launch wallet's launch rules on one chain, as it names them, each launch call pinning an input
// as a built one does; none for an agent wallet's chain.
function heldLaunchOf(
  read: readonly HeldRule[],
  chainId: string,
): Pick<CeilingChainLists, "launch"> | undefined {
  const rules = read.filter((rule) => isCallRule(rule, chainId, launchCallPrefix));
  const approvals = namedRule(read, "Launch approvals", chainId);
  const calls = rules.map(callIn);
  const parsed = calls.flatMap((call) => (call === undefined ? [] : [call]));
  if (parsed.length !== calls.length) {
    return undefined;
  }
  if (rules.length === 0 && approvals === undefined) {
    return {};
  }
  const checked = launchListsOf(
    parsed.map(({ abi, walletInputs }) => ({ abi, walletInputs })),
    chainId,
  );
  return checked.ok
    ? { launch: { calls: checked.value, approvesAnySpender: approvals !== undefined } }
    : undefined;
}

// The lists of one chain as its rules name them, checksummed; undefined when one cannot be read.
function listsOf(read: readonly HeldRule[], chainId: string): CeilingChainLists | undefined {
  const callRules = read.filter((rule) => isCallRule(rule, chainId));
  const calls = callRules.map(checkedCall);
  const approvals = namedRule(read, "Approvals", chainId);
  const spenders = addressList(
    approvals === undefined ? [] : valuesOf(approvals, "approve.spender", "in"),
  );
  const capped = anyCallRules(read, chainId);
  const cap = capOf(capped);
  const caps = capsOf(capped, approvals ?? namedRule(read, "Launch approvals", chainId));
  const launch = heldLaunchOf(read, chainId);
  const parsed = calls.flatMap((call) => (call === undefined ? [] : [call]));
  if (!spenders.ok || cap === undefined || caps === undefined || parsed.length !== calls.length) {
    return undefined;
  }
  if (launch === undefined || (capped.length > 0 && caps.native === undefined)) {
    return undefined;
  }
  const lists = { chainId, calls: parsed, spenders: spenders.value, perTxNativeCapBase: cap, caps };
  return { ...lists, ...launch };
}

/**
 * Reads a ceiling `buildCeiling` built back from the rules Privy holds: the chains its rules name,
 * the contracts its call rules let a call reach and the cap of the first call or launch call rule,
 * the addresses its native send rules let a send pay, the 24-hour caps of each chain whose rules
 * allow calls, and whether it is a launch wallet's.
 * Rules this does not know count only for their chain. A rule it cannot read, or a cap that is no
 * quantity, makes the answer `undefined`.
 */
export function readCeiling(rules: readonly JsonValue[]): CeilingHeld | undefined {
  const read = heldRules(rules);
  if (read === undefined) {
    return undefined;
  }
  const calls = read.filter((rule) => isCallRule(rule));
  const sends = read.filter((rule) => rule.name.startsWith("Native sends, chain "));
  const perTxNativeCapBase = capOf(anyCallRules(read));
  if (perTxNativeCapBase === undefined) {
    return undefined;
  }
  const chainIds = chainIdsOf(read);
  const caps = chainIds.flatMap((chainId): readonly HeldCaps[] => {
    const approvals = namedRule(read, "Approvals", chainId);
    const held = capsOf(
      anyCallRules(read, chainId),
      approvals ?? namedRule(read, "Launch approvals", chainId),
    );
    return held?.native === undefined
      ? []
      : [{ chainId, caps: { native: held.native, approvals: held.approvals } }];
  });
  return {
    chainIds,
    contracts: [...new Set(calls.flatMap((rule) => valuesOf(rule, "to", "in")))],
    perTxNativeCapBase,
    recipients: [...new Set(sends.flatMap((rule) => valuesOf(rule, "to", "in")))],
    caps,
    isLaunch: read.some(isLaunchRule),
    launchCalls: [...new Set(read.flatMap(launchFunctionOf))],
    functions: [
      ...new Set(calls.map((rule) => rule.name.slice(callPrefix.length).replace(onChain, ""))),
    ],
  };
}

/**
 * Whether rules Privy holds are exactly a ceiling `buildCeiling` builds: the ceiling rebuilt
 * from the chains, calls, spenders, caps, launch rules and native-send recipients they name has the
 * same rules,
 * compared as the read-back compares them. A token send to a recipient the native sends do not
 * list, a call rule without its 24-hour cap, a rule of no ceiling or a lowercase address fails it.
 */
export function isBuiltCeiling(rules: readonly JsonValue[]): boolean {
  const read = heldRules(rules);
  if (read === undefined) {
    return false;
  }
  const chainIds = chainIdsOf(read);
  const [first] = chainIds;
  const lists = chainIds.map((chainId) => listsOf(read, chainId));
  const sends = first === undefined ? undefined : namedRule(read, "Native sends", first);
  const recipients = addressList(sends === undefined ? [] : valuesOf(sends, "to", "in"));
  const chains = lists.flatMap((item) => (item === undefined ? [] : [item]));
  if (
    chains.length !== lists.length ||
    chains.length === 0 ||
    !recipients.ok ||
    recipients.value.length === 0
  ) {
    return false;
  }
  const built = ruleTexts(ceilingRules(chains, recipients.value).map(policyRuleJson));
  const held = ruleTexts(rules);
  return held !== undefined && JSON.stringify(held) === JSON.stringify(built);
}
