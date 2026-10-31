import { err, ok, type Result } from "@binference/core";
import { isPrivyId } from "../privy/privy-records.js";
import { addressList } from "./address-list.js";
import { bridgeRules, checkedTargets } from "./bridge-rules.js";
import {
  type CallRuleLists,
  callListsOf,
  callRuleName,
  launchCallRuleName,
  launchListsOf,
} from "./call-lists.js";
import { approveAbi, transferAbi } from "./ceiling-abis.js";
import { ceilingBytes, maxCeilingBytes } from "./ceiling-size.js";
import {
  type Ceiling,
  type BridgeTarget,
  type CeilingChain,
  type CeilingProblem,
  type CeilingRequest,
  type ChainCaps,
  type DayCap,
  type LaunchCall,
  type LaunchCeiling,
  maxAggregations,
} from "./ceiling.js";
import type { PolicyCondition, PolicyRule } from "./policy-rule.js";
import {
  allow,
  hexOf,
  noValue,
  onCalldata,
  onCap,
  onTransaction,
  walletAddress,
} from "./policy-rule.js";

/**
 * The two rules of one chain that name who a send may pay: a native send, and a token `transfer`
 * with no native coin. Changing a ceiling's recipients changes these two rules and nothing else.
 */
export function recipientRules(
  chainId: string,
  recipients: readonly string[],
): readonly PolicyRule[] {
  const onChain = onTransaction("chain_id", "eq", chainId);
  return [
    allow(`Native sends, chain ${chainId}`, [onChain, onTransaction("to", "in", recipients)]),
    allow(`Token sends, chain ${chainId}`, [
      onChain,
      onTransaction("value", "lte", noValue),
      onCalldata(transferAbi, "transfer.to", recipients),
    ]),
  ];
}

/** The caps one chain's rules name: a chain whose rules allow no call names no native cap. */
interface CapLists {
  readonly native?: DayCap;
  readonly approvals: readonly DayCap[];
}

/**
 * What one chain's rules of a ceiling list: its EIP-155 id, the calls each function may make, the
 * spenders an approval may name, the native cap of one call and the 24-hour caps. Addresses are
 * checksummed.
 */
export interface CeilingChainLists {
  /** The EIP-155 chain id as decimal text, as the rules write it. */
  readonly chainId: string;
  readonly calls: readonly CallRuleLists[];
  readonly spenders: readonly string[];
  readonly perTxNativeCapBase: bigint;
  readonly caps: CapLists;
  /** What a launch wallet's rules add on the chain, its calls checked; absent on an agent wallet. */
  readonly launch?: LaunchCeiling;
  /** The bridge targets, checked (decision 0302); absent when the chain has none. */
  readonly bridges?: readonly BridgeTarget[];
}

// A call of one function: on the chain, with at most the cap in native coin and the 24-hour native
// cap not passed, its pinned inputs the wallet itself; to its contracts when it lists some.
function callConditions(
  lists: CeilingChainLists,
  call: LaunchCall,
  contracts: readonly PolicyCondition[],
): readonly PolicyCondition[] {
  const { abi } = call;
  const { native } = lists.caps;
  const pins = call.walletInputs.map((input) =>
    onCalldata(abi, `${abi.name}.${input}`, walletAddress),
  );
  return [
    onTransaction("chain_id", "eq", lists.chainId),
    ...contracts,
    onTransaction("value", "lte", hexOf(lists.perTxNativeCapBase)),
    onCalldata(abi, "function_name", abi.name),
    ...pins,
    ...(native === undefined ? [] : [onCap(native)]),
  ];
}

function callRule(lists: CeilingChainLists, call: CallRuleLists): PolicyRule {
  const to = onTransaction("to", "in", call.contracts);
  return allow(callRuleName(call.abi.name, lists.chainId), callConditions(lists, call, [to]));
}

// A launch wallet's rules on one chain (decision 0217): each launch call on any contract, and an
// `approve` with no native coin naming any spender, each under the chain's 24-hour caps. A contract
// made with each launch has no address a rule could list, so these rules name none.
function launchRulesOf(lists: CeilingChainLists): readonly PolicyRule[] {
  const { chainId, launch } = lists;
  if (launch === undefined) {
    return [];
  }
  const calls = launch.calls.map((call) =>
    allow(launchCallRuleName(call.abi.name, chainId), callConditions(lists, call, [])),
  );
  const approvals = allow(`Launch approvals, chain ${chainId}`, [
    onTransaction("chain_id", "eq", chainId),
    onTransaction("value", "lte", noValue),
    onCalldata(approveAbi, "function_name", approveAbi.name),
    ...lists.caps.approvals.map(onCap),
  ]);
  return [...calls, ...(launch.approvesAnySpender ? [approvals] : [])];
}

// The call rules, the bridge rules and the approval rule of one chain, then a launch wallet's
// rules; no approval rule for no spender.
function callRulesOf(lists: CeilingChainLists): readonly PolicyRule[] {
  const { chainId } = lists;
  const approvals = allow(`Approvals, chain ${chainId}`, [
    onTransaction("chain_id", "eq", chainId),
    onTransaction("value", "lte", noValue),
    onCalldata(approveAbi, "approve.spender", lists.spenders),
    ...lists.caps.approvals.map(onCap),
  ]);
  return [
    ...lists.calls.map((call) => callRule(lists, call)),
    ...(lists.bridges ?? []).flatMap((target) => bridgeRules(target, chainId)),
    ...(lists.spenders.length > 0 ? [approvals] : []),
    ...launchRulesOf(lists),
  ];
}

function chainRules(
  lists: CeilingChainLists,
  recipients: readonly string[],
): readonly PolicyRule[] {
  const { chainId } = lists;
  return [
    ...callRulesOf(lists),
    ...recipientRules(chainId, recipients),
    allow(`Self cancel, chain ${chainId}`, [
      onTransaction("chain_id", "eq", chainId),
      onTransaction("to", "eq", walletAddress),
      onTransaction("value", "lte", noValue),
    ]),
  ];
}

// Privy refuses an owner's export unless the wallet's policy allows it; a signer can never export.
const ownerExport: PolicyRule = {
  name: "Owner export",
  method: "exportPrivateKey",
  action: "ALLOW",
  conditions: [],
};

function capsChecked(caps: ChainCaps): Result<ChainCaps, CeilingProblem> {
  const all = [caps.native, ...caps.approvals];
  if (all.some((cap) => cap.limitBase < 0n)) {
    return err("negative_cap");
  }
  return all.every((cap) => isPrivyId(cap.aggregation)) ? ok(caps) : err("bad_cap");
}

// A launch wallet's launch calls, checked; nothing for an agent wallet's chain.
function launchOf(
  chain: CeilingChain,
  chainId: string,
): Result<Pick<CeilingChainLists, "launch">, CeilingProblem> {
  if (chain.launch === undefined) {
    return ok({});
  }
  const calls = launchListsOf(chain.launch.calls, chainId);
  const { approvesAnySpender } = chain.launch;
  return calls.ok ? ok({ launch: { calls: calls.value, approvesAnySpender } }) : calls;
}

// A chain's bridge targets, checked; absent when none. A target's function may not also be a plain
// call rule's, which would let it pay anyone.
function bridgesOf(
  chain: CeilingChain,
  chainId: string,
  calls: readonly CallRuleLists[],
): Result<Pick<CeilingChainLists, "bridges">, CeilingProblem> {
  const targets = checkedTargets(chain.bridges ?? [], chainId);
  if (!targets.ok) {
    return targets;
  }
  const plain = new Set(calls.map((call) => call.abi.name));
  if (targets.value.some((target) => plain.has(target.call.abi.name))) {
    return err("bad_bridge");
  }
  return ok(targets.value.length === 0 ? {} : { bridges: targets.value });
}

function chainLists(chain: CeilingChain): Result<CeilingChainLists, CeilingProblem> {
  if (chain.perTxNativeCapBase < 0n) {
    return err("negative_cap");
  }
  const chainId = String(chain.chain.chainId);
  const calls = callListsOf(chain.calls, chainId);
  if (!calls.ok) {
    return calls;
  }
  const spenders = addressList(chain.spenders);
  if (!spenders.ok) {
    return spenders;
  }
  const launch = launchOf(chain, chainId);
  if (!launch.ok) {
    return launch;
  }
  const extras = bridgesOf(chain, chainId, calls.value);
  if (!extras.ok) {
    return extras;
  }
  const caps = capsChecked(chain.caps);
  const { perTxNativeCapBase } = chain;
  return caps.ok
    ? ok({
        chainId,
        calls: calls.value,
        spenders: spenders.value,
        perTxNativeCapBase,
        caps: caps.value,
        ...launch.value,
        ...extras.value,
      })
    : caps;
}

function eachChain(
  chains: readonly CeilingChain[],
): Result<readonly CeilingChainLists[], CeilingProblem> {
  if (chains.length === 0) {
    return err("no_chain");
  }
  if (new Set(chains.map((item) => item.chain.ref)).size !== chains.length) {
    return err("repeated_chain");
  }
  const lists: CeilingChainLists[] = [];
  for (const chain of chains) {
    const checked = chainLists(chain);
    if (!checked.ok) {
      return checked;
    }
    lists.push(checked.value);
  }
  const aggregations = chains.flatMap(({ caps }) => [caps.native, ...caps.approvals]);
  const distinct = new Set(aggregations.map((cap) => cap.aggregation));
  return distinct.size > maxAggregations ? err("too_many_caps") : ok(lists);
}

/**
 * The rules of one chain that name what a contract call may do: call each listed function on its
 * contracts with at most the cap in native coin while the 24-hour native cap holds, and approve
 * only the listed spenders while each token's 24-hour cap holds, and on a launch wallet's chain its
 * launch rules (decision 0217). Changing a ceiling's venues or cap changes these rules and nothing
 * else. No call gives no call rule and no spender no approval rule; a malformed address, call or
 * cap is refused.
 */
export function callRules(chain: CeilingChain): Result<readonly PolicyRule[], CeilingProblem> {
  const lists = chainLists(chain);
  return lists.ok ? ok(callRulesOf(lists.value)) : lists;
}

/**
 * Builds a wallet's ceiling (spec 5, section 4; decision 0149) as Privy policy rules for
 * `eth_signTransaction`, the one signing method it allows. On each enabled chain it allows: each
 * venue function its venues declare, by `function_name`, on the contracts they declare it on,
 * with at most the cap in native coin, its pinned inputs the signing wallet itself, while the
 * 24-hour native cap holds; an `approve` with no native coin to a declared spender, while each
 * capped token's 24-hour cap holds; a native send or a token `transfer` to the rescue address or a
 * saved address; a zero-value transfer to the wallet itself, which cancels a stuck transaction. A
 * launch wallet's chain also allows each launch call, by `function_name` on any contract, its
 * pinned inputs the wallet itself, and an `approve` with no native coin naming any spender, each
 * under the same caps (decision 0217). It lets the owner, never a signer, export the key. Privy denies everything else, typed data,
 * `personal_sign` and every EIP-7702 authorization among it: no rule names that method, and Privy
 * refuses a rule without conditions for it (seen on a Privy app, 2026-10-11). It holds no `DENY` rule on
 * calldata: Privy denies every transaction whose calldata such a rule cannot decode, plain sends
 * among them (seen on a Privy app, 2026-10-07).
 */
export function buildCeiling(request: CeilingRequest): Result<Ceiling, CeilingProblem> {
  const lists = eachChain(request.chains);
  if (!lists.ok) {
    return lists;
  }
  const recipients = addressList([request.rescue, ...request.saved]);
  if (!recipients.ok) {
    return recipients;
  }
  const rules = ceilingRules(lists.value, recipients.value);
  if (ceilingBytes(rules) > maxCeilingBytes) {
    return err("too_large");
  }
  return ok({ chains: request.chains.map((item) => item.chain.ref), rules });
}

/**
 * The rules {@link buildCeiling} writes for chains whose lists are checked and checksummed, and
 * recipients that are: each chain's rules in the order given, then the rules of no chain.
 */
export function ceilingRules(
  chains: readonly CeilingChainLists[],
  recipients: readonly string[],
): readonly PolicyRule[] {
  return [...chains.flatMap((item) => chainRules(item, recipients)), ownerExport];
}
