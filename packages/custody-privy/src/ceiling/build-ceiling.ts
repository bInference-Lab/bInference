import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { isPrivyId } from "../privy/privy-records.js";
import { type CallRuleLists, callListsOf, callRuleName } from "./call-lists.js";
import { approveAbi, transferAbi } from "./ceiling-abis.js";
import {
  type Ceiling,
  type CeilingChain,
  type CeilingProblem,
  type CeilingRequest,
  type ChainCaps,
  type DayCap,
  maxAggregations,
} from "./ceiling.js";
import type {
  CalldataCondition,
  PolicyCondition,
  PolicyRule,
  ReferenceCondition,
  TransactionCondition,
} from "./policy-rule.js";

// Privy's `in` operator takes at most 100 values.
const maxListed = 100;
const noValue = "0x0";
// Privy puts the address of the wallet that signs in place of this variable.
const walletAddress = "{{wallet.address}}";

/** Why a list of recipients cannot go in a ceiling. */
export type AddressProblem = "malformed_address" | "too_many_addresses";

/**
 * The recipients a ceiling lists: checksummed, each once, in the order given, since Privy compares
 * strings case by case. More than 100 is `too_many_addresses`: Privy's `in` takes at most 100.
 */
export function addressList(texts: readonly string[]): Result<readonly string[], AddressProblem> {
  const listed = new Set<string>();
  for (const text of texts) {
    const address = parseEvmAddress(text);
    if (!address.ok) {
      return address;
    }
    listed.add(address.value);
  }
  return listed.size > maxListed ? err("too_many_addresses") : ok([...listed]);
}

function hexOf(value: bigint): string {
  return `0x${value.toString(16)}`;
}

function onTransaction(
  field: TransactionCondition["field"],
  operator: TransactionCondition["operator"],
  value: TransactionCondition["value"],
): TransactionCondition {
  return { field_source: "ethereum_transaction", field, operator, value };
}

function onCalldata(
  abi: CalldataCondition["abi"][number],
  field: string,
  value: CalldataCondition["value"],
): CalldataCondition {
  return {
    field_source: "ethereum_calldata",
    field,
    abi: [abi],
    operator: typeof value === "string" ? "eq" : "in",
    value,
  };
}

function onCap(cap: DayCap): ReferenceCondition {
  const field = `aggregation.${cap.aggregation}`;
  return { field_source: "reference", field, operator: "lte", value: hexOf(cap.limitBase) };
}

function allow(name: string, conditions: readonly PolicyCondition[]): PolicyRule {
  return { name, method: "eth_signTransaction", action: "ALLOW", conditions };
}

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
}

// One function's calls: on the chain, to its contracts, with at most the cap in native coin and
// the 24-hour native cap not passed, its pinned inputs the wallet itself.
function callRule(lists: CeilingChainLists, call: CallRuleLists): PolicyRule {
  const { abi } = call;
  const { native } = lists.caps;
  const pins = call.walletInputs.map((input) =>
    onCalldata(abi, `${abi.name}.${input}`, walletAddress),
  );
  return allow(callRuleName(abi.name, lists.chainId), [
    onTransaction("chain_id", "eq", lists.chainId),
    onTransaction("to", "in", call.contracts),
    onTransaction("value", "lte", hexOf(lists.perTxNativeCapBase)),
    onCalldata(abi, "function_name", abi.name),
    ...pins,
    ...(native === undefined ? [] : [onCap(native)]),
  ]);
}

// The call rules and the approval rule of one chain; no approval rule for no spender.
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
    ...(lists.spenders.length > 0 ? [approvals] : []),
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

// A wallet with delegated code would run it on a self call, which the self-cancel rule allows with
// any calldata: no EIP-7702 authorization is ever signed. Privy denies a method no rule allows;
// this rule keeps it denied if an allow rule for it is ever added.
const noDelegation: PolicyRule = {
  name: "No EIP-7702 delegation",
  method: "eth_sign7702Authorization",
  action: "DENY",
  conditions: [],
};

function capsChecked(caps: ChainCaps): Result<ChainCaps, CeilingProblem> {
  const all = [caps.native, ...caps.approvals];
  if (all.some((cap) => cap.limitBase < 0n)) {
    return err("negative_cap");
  }
  return all.every((cap) => isPrivyId(cap.aggregation)) ? ok(caps) : err("bad_cap");
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
  const caps = capsChecked(chain.caps);
  const { perTxNativeCapBase } = chain;
  return caps.ok
    ? ok({
        chainId,
        calls: calls.value,
        spenders: spenders.value,
        perTxNativeCapBase,
        caps: caps.value,
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
 * only the listed spenders while each token's 24-hour cap holds. Changing a ceiling's venues or cap
 * changes these rules and nothing else. No call gives no call rule and no spender no approval
 * rule; a malformed address, call or cap is refused.
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
 * saved address; a zero-value transfer to the wallet itself, which cancels a stuck transaction. It
 * lets the owner, never a signer, export the key, and denies every EIP-7702 authorization. Privy
 * denies everything else, typed data and `personal_sign` among it. It holds no `DENY` rule on
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
  return ok({
    chains: request.chains.map((item) => item.chain.ref),
    rules: ceilingRules(lists.value, recipients.value),
  });
}

/**
 * The rules {@link buildCeiling} writes for chains whose lists are checked and checksummed, and
 * recipients that are: each chain's rules in the order given, then the rules of no chain.
 */
export function ceilingRules(
  chains: readonly CeilingChainLists[],
  recipients: readonly string[],
): readonly PolicyRule[] {
  return [...chains.flatMap((item) => chainRules(item, recipients)), ownerExport, noDelegation];
}
