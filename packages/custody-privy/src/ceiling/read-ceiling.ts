import type { JsonValue } from "@binference/core";
import { ruleTexts } from "../wallets/policy-rules.schema.js";
import { addressList } from "./address-list.js";
import { checkedTargets } from "./bridge-rules.js";
import { type CeilingChainLists, ceilingRules } from "./build-ceiling.js";
import { type CallRuleLists, launchListsOf } from "./call-lists.js";
import type { ChainAddresses, ChainCaps } from "./ceiling.js";
import {
  callIn,
  capsIn,
  type HeldRule,
  heldRules,
  quantityOf,
  valuesOf,
} from "./held-rules.schema.js";
import { policyRuleJson } from "./policy-rule.js";
import {
  type HeldBridge,
  heldBridgesOf,
  heldTargetsOf,
  isBridgeRuleName,
} from "./read-bridge-rules.js";

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
  /**
   * The contracts its rules name, each once: those a call rule lets a call reach, the spenders an
   * approval rule lets a token approve, and those a bridge rule lets a deposit reach. A venue is in
   * the ceiling when one of its contracts is here, whichever rule names it.
   */
  readonly contracts: readonly string[];
  /**
   * The most native coin, in base units, one contract call may send on the first chain that
   * allows calls; 0 when no chain does.
   */
  readonly perTxNativeCapBase: bigint;
  /**
   * Per chain the ceiling enables, every address its native send rule lets a send pay, each once,
   * in the order the rules name the chains (decision 0313).
   */
  readonly recipients: readonly ChainAddresses[];
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
   * The functions its call and bridge rules let a call reach on their contracts, each once, on any
   * chain: a change of them is a change of what the ceiling allows (decision 0271).
   */
  readonly functions: readonly string[];
  /** Each bridge rule's target, in the order the rules name them (decision 0302). */
  readonly bridges: readonly HeldBridge[];
  /**
   * Each function a call rule holds to a cap of its own, such as a stake's (decision 0325), with
   * that cap in base units of the native coin, in the order the rules name them; absent when no
   * rule has one, as in a ceiling written before such rules existed.
   */
  readonly ownCaps?: readonly OwnCallCap[];
}

/** A function a call rule holds to a cap of its own, and that cap in native base units. */
export interface OwnCallCap {
  readonly functionName: string;
  readonly maxValueBase: bigint;
}

// The functions held to caps of their own, each with its cap; a rule whose call or cap cannot be
// read leaves the answer `undefined`.
function ownCapsOf(calls: readonly HeldRule[]): readonly OwnCallCap[] | undefined {
  const own = calls.filter((rule) => ownCap.test(rule.name));
  const read = own.map((rule) => {
    const functionName = callIn(rule)?.abi.name;
    const maxValueBase = quantityOf(valuesOf(rule, "value", "lte")[0]);
    return functionName === undefined || maxValueBase === undefined
      ? undefined
      : { functionName, maxValueBase };
  });
  const caps = read.flatMap((item) => (item === undefined ? [] : [item]));
  return caps.length === read.length ? caps : undefined;
}

const onChain = /, chain (\d{1,10})$/;
const callPrefix = "Call ";
// A call rule with a cap of its own (decision 0325).
const ownCap = /^Call [^,]+, own cap, chain \d{1,10}$/;
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

// The chain's cap per call, from its first call rule that has no cap of its own: 0 for none,
// undefined when it is no quantity.
function capOf(calls: readonly HeldRule[]): bigint | undefined {
  const first = calls.find((rule) => !ownCap.test(rule.name));
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

// One call rule's function, pins, contracts, checksummed, and its own cap when its name says it has
// one; undefined when it cannot be read.
function checkedCall(rule: HeldRule): CallRuleLists | undefined {
  const call = callIn(rule);
  const contracts = call === undefined ? undefined : addressList(call.contracts);
  const cap = ownCap.test(rule.name) ? quantityOf(valuesOf(rule, "value", "lte")[0]) : 0n;
  if (call === undefined || contracts?.ok !== true || cap === undefined) {
    return undefined;
  }
  return { ...call, contracts: contracts.value, ...(cap === 0n ? {} : { maxValueBase: cap }) };
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

// A chain's bridge targets as its rules name them; undefined when a bridge rule cannot be read, or
// reads as a target no ceiling is built with.
function extrasOf(
  read: readonly HeldRule[],
  chainId: string,
): Pick<CeilingChainLists, "bridges"> | undefined {
  const targets = heldTargetsOf(read, chainId);
  const checked = targets === undefined ? undefined : checkedTargets(targets, chainId);
  if (checked?.ok !== true) {
    return undefined;
  }
  return checked.value.length === 0 ? {} : { bridges: checked.value };
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
  const held = heldPartsOf(read, chainId);
  const parsed = calls.flatMap((call) => (call === undefined ? [] : [call]));
  if (!spenders.ok || cap === undefined || caps === undefined || parsed.length !== calls.length) {
    return undefined;
  }
  if (held === undefined || (capped.length > 0 && caps.native === undefined)) {
    return undefined;
  }
  const lists = { chainId, calls: parsed, spenders: spenders.value, perTxNativeCapBase: cap, caps };
  return { ...lists, ...held };
}

// A chain's launch rules and bridge targets as its rules name them; undefined when either cannot be
// read as built.
function heldPartsOf(
  read: readonly HeldRule[],
  chainId: string,
): Pick<CeilingChainLists, "launch" | "bridges"> | undefined {
  const launch = heldLaunchOf(read, chainId);
  const bridges = extrasOf(read, chainId);
  return launch === undefined || bridges === undefined ? undefined : { ...launch, ...bridges };
}

// The 24-hour caps of each chain whose rules allow calls.
function heldCapsOf(read: readonly HeldRule[], chainIds: readonly string[]): readonly HeldCaps[] {
  return chainIds.flatMap((chainId): readonly HeldCaps[] => {
    const approvals = namedRule(read, "Approvals", chainId);
    const held = capsOf(
      anyCallRules(read, chainId),
      approvals ?? namedRule(read, "Launch approvals", chainId),
    );
    return held?.native === undefined
      ? []
      : [{ chainId, caps: { native: held.native, approvals: held.approvals } }];
  });
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
  const bridges = read.filter((rule) => isBridgeRuleName(rule.name));
  const approvalRules = read.filter((rule) => rule.name.startsWith("Approvals, chain "));
  const sends = read.filter((rule) => rule.name.startsWith("Native sends, chain "));
  const perTxNativeCapBase = capOf(anyCallRules(read));
  const ownCaps = ownCapsOf(calls);
  if (perTxNativeCapBase === undefined || ownCaps === undefined) {
    return undefined;
  }
  const chainIds = chainIdsOf(read);
  const caps = heldCapsOf(read, chainIds);
  return {
    chainIds,
    contracts: [
      ...new Set([
        ...[...calls, ...bridges].flatMap((rule) => valuesOf(rule, "to", "in")),
        ...approvalRules.flatMap((rule) => valuesOf(rule, "approve.spender", "in")),
      ]),
    ],
    perTxNativeCapBase,
    recipients: sends.map((rule) => ({
      chainId: onChain.exec(rule.name)?.[1] ?? "",
      addresses: [...new Set(valuesOf(rule, "to", "in"))],
    })),
    caps,
    isLaunch: read.some(isLaunchRule),
    launchCalls: [...new Set(read.flatMap(launchFunctionOf))],
    functions: [
      ...new Set([
        ...calls.flatMap((rule) => callIn(rule)?.abi.name ?? []),
        ...bridges.flatMap((rule) => callIn(rule)?.abi.name ?? []),
      ]),
    ],
    bridges: heldBridgesOf(read, chainIds),
    ...(ownCaps.length === 0 ? {} : { ownCaps }),
  };
}

/**
 * Whether rules Privy holds are exactly a ceiling `buildCeiling` builds: the ceiling rebuilt
 * from the chains, calls, spenders, caps, launch rules and each chain's native-send recipients
 * they name has the same rules, compared as the read-back compares them. A token send to a
 * recipient its chain's native sends do not list, a call rule without its 24-hour cap, a rule of
 * no ceiling or a lowercase address fails it.
 */
export function isBuiltCeiling(rules: readonly JsonValue[]): boolean {
  const read = heldRules(rules);
  if (read === undefined) {
    return false;
  }
  const chainIds = chainIdsOf(read);
  const lists = chainIds.map((chainId) => listsOf(read, chainId));
  const recipients = chainIds.map((chainId) => sendsOf(read, chainId));
  const chains = lists.flatMap((item) => (item === undefined ? [] : [item]));
  const sends = recipients.flatMap((item) => (item === undefined ? [] : [item]));
  if (chains.length !== lists.length || chains.length === 0 || sends.length !== chainIds.length) {
    return false;
  }
  const built = ruleTexts(ceilingRules(chains, sends).map(policyRuleJson));
  const held = ruleTexts(rules);
  return held !== undefined && JSON.stringify(held) === JSON.stringify(built);
}

// A chain's native-send recipients, checksummed; undefined when it lists none or one malformed.
function sendsOf(read: readonly HeldRule[], chainId: string): ChainAddresses | undefined {
  const sends = namedRule(read, "Native sends", chainId);
  const listed = addressList(sends === undefined ? [] : valuesOf(sends, "to", "in"));
  return listed.ok && listed.value.length > 0 ? { chainId, addresses: listed.value } : undefined;
}
