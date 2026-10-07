import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import { approveAbi, setApprovalForAllAbi, transferAbi } from "./ceiling-abis.js";
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

type AddressProblem = "malformed_address" | "too_many_addresses";

// Checksummed, each once, in the order given: Privy compares strings case by case.
function addressList(texts: readonly string[]): Result<readonly string[], AddressProblem> {
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

/** Lists for one chain, checked and checksummed. */
interface ChainLists {
  readonly chain: CeilingChain;
  readonly contracts: readonly string[];
  readonly spenders: readonly string[];
}

function chainRules(lists: ChainLists, recipients: readonly string[]): readonly PolicyRule[] {
  const { chainId } = lists.chain.chain;
  const onChain = onTransaction("chain_id", "eq", String(chainId));
  const noCoin = onTransaction("value", "lte", noValue);
  const cap = `0x${lists.chain.perTxNativeCapBase.toString(16)}`;
  const calls = allow(`Contract calls, chain ${String(chainId)}`, [
    onChain,
    onTransaction("to", "in", lists.contracts),
    onTransaction("value", "lte", cap),
  ]);
  const approvals = allow(`Approvals, chain ${String(chainId)}`, [
    onChain,
    noCoin,
    onCalldata(approveAbi, "approve.spender", lists.spenders),
  ]);
  return [
    ...(lists.contracts.length > 0 ? [calls] : []),
    ...(lists.spenders.length > 0 ? [approvals] : []),
    allow(`Native sends, chain ${String(chainId)}`, [
      onChain,
      onTransaction("to", "in", recipients),
    ]),
    allow(`Token sends, chain ${String(chainId)}`, [
      onChain,
      noCoin,
      onCalldata(transferAbi, "transfer.to", recipients),
    ]),
    allow(`Self cancel, chain ${String(chainId)}`, [
      onChain,
      onTransaction("to", "eq", walletAddress),
      noCoin,
    ]),
  ];
}

const denyApprovalForAll: PolicyRule = {
  name: "No setApprovalForAll",
  method: "eth_signTransaction",
  action: "DENY",
  conditions: [onCalldata(setApprovalForAllAbi, "function_name", "setApprovalForAll")],
};

// Privy refuses an owner's export unless the wallet's policy allows it; a signer can never export.
const ownerExport: PolicyRule = {
  name: "Owner export",
  method: "exportPrivateKey",
  action: "ALLOW",
  conditions: [],
};

function chainLists(chain: CeilingChain): Result<ChainLists, CeilingProblem> {
  if (chain.perTxNativeCapBase < 0n) {
    return err("negative_cap");
  }
  const contracts = addressList(chain.contracts);
  if (!contracts.ok) {
    return contracts;
  }
  const spenders = addressList(chain.spenders);
  return spenders.ok
    ? ok({ chain, contracts: contracts.value, spenders: spenders.value })
    : spenders;
}

function eachChain(chains: readonly CeilingChain[]): Result<readonly ChainLists[], CeilingProblem> {
  if (chains.length === 0) {
    return err("no_chain");
  }
  if (new Set(chains.map((item) => item.chain.ref)).size !== chains.length) {
    return err("repeated_chain");
  }
  const lists: ChainLists[] = [];
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
 * Builds a wallet's ceiling (spec 5, section 4) as Privy policy rules for `eth_signTransaction`,
 * the one signing method it allows. On each enabled chain it allows: calls to the listed
 * contracts with at most the cap in native coin; an exact `approve` to a registry spender; a
 * native send or a token `transfer` to the rescue address or a saved address; a zero-value
 * transfer to the wallet itself, which cancels a stuck transaction. It denies
 * `setApprovalForAll` everywhere, and lets the owner, never a signer, export the key. Privy
 * denies everything else, typed data and `personal_sign` among it.
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
  const rules = lists.value.flatMap((item) => chainRules(item, recipients.value));
  return ok({
    chains: request.chains.map((item) => item.chain.ref),
    rules: [...rules, denyApprovalForAll, ownerExport],
  });
}
