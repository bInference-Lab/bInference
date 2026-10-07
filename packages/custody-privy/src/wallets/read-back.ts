import { parseEvmAddress } from "@binference/chain-evm";
import { err, ok, type Result } from "@binference/core";
import type { Ceiling } from "../ceiling/ceiling.js";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import type { CallOptions, PrivyApi } from "../privy/privy-api.js";
import type { KeyQuorum, PrivyId, PrivyPolicy, WalletRecord } from "../privy/privy-records.js";
import type { PrivyWallet } from "../signing/privy-owner-signer.js";
import { ruleTexts } from "./policy-rules.schema.js";

/**
 * What an agent wallet must be on Privy (spec 5, section 2, step 5): owned by the owner key
 * alone, with the agent key alone as its one added signer, both bound to the ceiling, which the
 * owner key alone may change. Keys are P-256 public halves, DER SubjectPublicKeyInfo in base64.
 */
export interface WalletExpectation {
  readonly ownerKey: string;
  readonly agentKey: string;
  readonly ceiling: Ceiling;
}

/**
 * Why a wallet on Privy is not the one asked for: Privy holds no such wallet; it is no Ethereum
 * wallet; its owner, its signer or its policy differs from the request.
 */
export type ReadBackProblem = "not_found" | "not_ethereum" | "owner" | "signer" | "policy";

/** A wallet with its key quorums and policies, as Privy reports them now. */
export interface WalletView {
  readonly wallet: WalletRecord;
  readonly quorums: ReadonlyMap<PrivyId, KeyQuorum>;
  readonly policies: ReadonlyMap<PrivyId, PrivyPolicy>;
}

function keyText(text: string): string {
  return text.replaceAll(/\s/g, "");
}

// A quorum of exactly this one key, which alone authorizes for it.
function isSoleKey(quorum: KeyQuorum | undefined, key: string): boolean {
  return (
    quorum !== undefined &&
    quorum.publicKeys.length === 1 &&
    quorum.publicKeys[0] === keyText(key) &&
    (quorum.threshold === null || quorum.threshold === 1) &&
    quorum.userIds.length === 0 &&
    quorum.memberQuorums.length === 0
  );
}

// The one added signer, holding the agent key, bound to one override policy: that policy's id.
function boundSigner(view: WalletView, agentKey: string): PrivyId | undefined {
  const [signer, ...others] = view.wallet.signers;
  const overrides = signer?.overridePolicyIds ?? [];
  const [policy] = overrides;
  const sole = signer !== undefined && others.length === 0 && overrides.length === 1;
  return sole && isSoleKey(view.quorums.get(signer.signerId), agentKey) ? policy : undefined;
}

function isTheCeiling(
  policy: PrivyPolicy | undefined,
  view: WalletView,
  ceiling: Ceiling,
): boolean {
  const asked = ruleTexts(ceiling.rules.map(policyRuleJson));
  const held = policy === undefined ? undefined : ruleTexts(policy.rules);
  return (
    policy !== undefined &&
    policy.ownerId === view.wallet.ownerId &&
    policy.chainType === "ethereum" &&
    policy.version === "1.0" &&
    held !== undefined &&
    JSON.stringify(held) === JSON.stringify(asked)
  );
}

/**
 * Checks a wallet as Privy reports it against what was asked, and gives the wallet the adapter
 * signs for. Keys compare by their text with line breaks removed, rules by what decides their
 * effect. It reads nothing; {@link readBackWallet} fetches the view.
 */
export function checkWallet(
  view: WalletView,
  expected: WalletExpectation,
): Result<PrivyWallet, ReadBackProblem> {
  const address = parseEvmAddress(view.wallet.address);
  if (view.wallet.chainType !== "ethereum" || !address.ok) {
    return err("not_ethereum");
  }
  const { ownerId } = view.wallet;
  if (ownerId === null || !isSoleKey(view.quorums.get(ownerId), expected.ownerKey)) {
    return err("owner");
  }
  const policyId = boundSigner(view, expected.agentKey);
  if (policyId === undefined) {
    return err("signer");
  }
  const [walletPolicy, ...more] = view.wallet.policyIds;
  if (walletPolicy !== policyId || more.length > 0) {
    return err("policy");
  }
  return isTheCeiling(view.policies.get(policyId), view, expected.ceiling)
    ? ok({ id: view.wallet.id, address: address.value, chains: expected.ceiling.chains })
    : err("policy");
}

async function quorumsOf(
  api: PrivyApi,
  wallet: WalletRecord,
  options: CallOptions,
): Promise<ReadonlyMap<PrivyId, KeyQuorum>> {
  const ids = [
    ...(wallet.ownerId === null ? [] : [wallet.ownerId]),
    ...wallet.signers.map((item) => item.signerId),
  ];
  const found = await Promise.all(ids.map(async (id) => api.keyQuorum(id, options)));
  return new Map(found.flatMap((item) => (item.ok ? [[item.value.id, item.value] as const] : [])));
}

async function policiesOf(
  api: PrivyApi,
  wallet: WalletRecord,
  options: CallOptions,
): Promise<ReadonlyMap<PrivyId, PrivyPolicy>> {
  const overrides = wallet.signers.flatMap((item) => item.overridePolicyIds ?? []);
  const ids = [...new Set([...wallet.policyIds, ...overrides])];
  const found = await Promise.all(ids.map(async (id) => api.policy(id, options)));
  return new Map(found.flatMap((item) => (item.ok ? [[item.value.id, item.value] as const] : [])));
}

/**
 * Reads a wallet back from Privy with its owner, its signers and its policies, and checks it
 * against what was asked (spec 5, section 2, step 5). Nothing signs for a wallet that fails it.
 */
export async function readBackWallet(
  api: PrivyApi,
  request: { readonly wallet: PrivyId; readonly expected: WalletExpectation },
  options: CallOptions,
): Promise<Result<PrivyWallet, ReadBackProblem>> {
  const found = await api.wallet(request.wallet, options);
  if (!found.ok) {
    return found;
  }
  const [quorums, policies] = await Promise.all([
    quorumsOf(api, found.value, options),
    policiesOf(api, found.value, options),
  ]);
  return checkWallet({ wallet: found.value, quorums, policies }, request.expected);
}
