import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { approveAbi, transferAbi } from "./ceiling-abis.js";
import type { Ceiling, CeilingChain, CeilingProblem, CeilingRequest } from "./ceiling.js";
import type {
  CalldataCondition,
  PolicyCondition,
  PolicyRule,
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

/**
 * What one chain's rules of a ceiling list: its EIP-155 id, the contracts a call may reach, the
 * spenders an approval may name and the native cap of one call. Addresses are checksummed.
 */
export interface CeilingChainLists {
  /** The EIP-155 chain id as decimal text, as the rules write it. */
  readonly chainId: string;
  readonly contracts: readonly string[];
  readonly spenders: readonly string[];
  readonly perTxNativeCapBase: bigint;
}

// The contract-call and approval rules of one chain; none for a list that is empty.
function callRulesOf(lists: CeilingChainLists): readonly PolicyRule[] {
  const { chainId } = lists;
  const onChain = onTransaction("chain_id", "eq", chainId);
  const noCoin = onTransaction("value", "lte", noValue);
  const cap = `0x${lists.perTxNativeCapBase.toString(16)}`;
  const calls = allow(`Contract calls, chain ${chainId}`, [
    onChain,
    onTransaction("to", "in", lists.contracts),
    onTransaction("value", "lte", cap),
  ]);
  const approvals = allow(`Approvals, chain ${chainId}`, [
    onChain,
    noCoin,
    onCalldata(approveAbi, "approve.spender", lists.spenders),
  ]);
  return [
    ...(lists.contracts.length > 0 ? [calls] : []),
    ...(lists.spenders.length > 0 ? [approvals] : []),
  ];
}

function chainRules(
  lists: CeilingChainLists,
  recipients: readonly string[],
): readonly PolicyRule[] {
  const { chainId } = lists;
  const onChain = onTransaction("chain_id", "eq", chainId);
  const noCoin = onTransaction("value", "lte", noValue);
  return [
    ...callRulesOf(lists),
    ...recipientRules(chainId, recipients),
    allow(`Self cancel, chain ${chainId}`, [
      onChain,
      onTransaction("to", "eq", walletAddress),
      noCoin,
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

function chainLists(chain: CeilingChain): Result<CeilingChainLists, CeilingProblem> {
  if (chain.perTxNativeCapBase < 0n) {
    return err("negative_cap");
  }
  const contracts = addressList(chain.contracts);
  if (!contracts.ok) {
    return contracts;
  }
  const spenders = addressList(chain.spenders);
  const chainId = String(chain.chain.chainId);
  const { perTxNativeCapBase } = chain;
  return spenders.ok
    ? ok({ chainId, contracts: contracts.value, spenders: spenders.value, perTxNativeCapBase })
    : spenders;
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
  return ok(lists);
}

/**
 * The rules of one chain that name what a contract call may do: reach the chain's listed
 * contracts with at most its cap in native coin, and approve only its listed spenders. Changing a
 * ceiling's venues or cap changes these rules and nothing else. A list that is empty gives no
 * rule; a malformed address or a negative cap is refused.
 */
export function callRules(chain: CeilingChain): Result<readonly PolicyRule[], CeilingProblem> {
  const lists = chainLists(chain);
  return lists.ok ? ok(callRulesOf(lists.value)) : lists;
}

/**
 * Builds a wallet's ceiling (spec 5, section 4) as Privy policy rules for `eth_signTransaction`,
 * the one signing method it allows. On each enabled chain it allows: calls to the listed
 * contracts with at most the cap in native coin; an exact `approve` to a registry spender; a
 * native send or a token `transfer` to the rescue address or a saved address; a zero-value
 * transfer to the wallet itself, which cancels a stuck transaction. It lets the owner, never a
 * signer, export the key, and denies every EIP-7702 authorization. Privy denies everything else,
 * typed data and `personal_sign` among it. It holds no `DENY` rule on calldata: Privy denies
 * every transaction whose calldata such a rule cannot decode, plain sends among them (seen on a
 * Privy app, 2026-10-07). So `setApprovalForAll` is refused by the allowed sets, and on a listed
 * contract by the signer's hard rules.
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
