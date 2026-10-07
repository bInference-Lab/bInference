import type { JsonValue } from "@binference/core";
import { describe, expect, it } from "vitest";
import { policyRuleJson } from "../ceiling/policy-rule.js";
import { testCeiling } from "../contracts/privy-custody-setup.js";
import type { KeyQuorum, PrivyId, PrivyPolicy, WalletRecord } from "../privy/privy-records.js";
import { testChain } from "../testing/custody-fixtures.js";
import { createFakeCustodySubject } from "../testing/fake-custody-subject.js";
import {
  checkWallet,
  type ReadBackProblem,
  readBackWallet,
  type WalletExpectation,
  type WalletView,
} from "./read-back.js";

const ownerKey =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEownerownerownerownerownerownerownerownerownerownerownerownerownerownerownerowner==";
const agentKey =
  "MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAEagentagentagentagentagentagentagentagentagentagentagentagentagentagentagentagen==";
const id = (text: string): PrivyId => text as PrivyId;
const [ownerId, agentId, policyId, walletId] = [
  id("ownerquorum"),
  id("agentquorum"),
  id("ceilingpolicy"),
  id("wallet"),
];
const address = "0xF1DBff66C993EE895C8cb176c30b07A559d76496";

const quorum = (quorumId: PrivyId, key: string, change: Partial<KeyQuorum> = {}): KeyQuorum => ({
  id: quorumId,
  publicKeys: [key],
  threshold: 1,
  userIds: [],
  memberQuorums: [],
  ...change,
});

const expected: WalletExpectation = { ownerKey, agentKey, ceiling: testCeiling() };
const rules: readonly JsonValue[] = expected.ceiling.rules.map(policyRuleJson);

const policy: PrivyPolicy = { id: policyId, version: "1.0", chainType: "ethereum", ownerId, rules };

const wallet: WalletRecord = {
  id: walletId,
  address: address.toLowerCase(),
  chainType: "ethereum",
  ownerId,
  policyIds: [policyId],
  signers: [{ signerId: agentId, overridePolicyIds: [policyId] }],
};

function view(
  change: {
    readonly wallet?: Partial<WalletRecord>;
    readonly owner?: Partial<KeyQuorum>;
    readonly agent?: Partial<KeyQuorum>;
    readonly policy?: Partial<PrivyPolicy>;
  } = {},
): WalletView {
  return {
    wallet: { ...wallet, ...change.wallet },
    quorums: new Map([
      [ownerId, quorum(ownerId, ownerKey, change.owner)],
      [agentId, quorum(agentId, agentKey, change.agent)],
    ]),
    policies: new Map([[policyId, { ...policy, ...change.policy }]]),
  };
}

// Privy may answer a rule's fields in another order, with its own ids and `in` values reordered.
function reversedValues(condition: Record<string, JsonValue>): JsonValue {
  return Object.fromEntries(
    Object.entries(condition).map(([key, value]) => [
      key,
      Array.isArray(value) && key === "value" ? value.toReversed() : value,
    ]),
  );
}

function echoed(rule: JsonValue): JsonValue {
  const { conditions, ...rest } = rule as { conditions: Record<string, JsonValue>[] };
  return { id: "rule-id", ...rest, conditions: conditions.toReversed().map(reversedValues) };
}

describe("checkWallet", () => {
  it("accepts a wallet that is exactly what was asked, and gives its checksummed address and chains", () => {
    expect(checkWallet(view(), expected)).toStrictEqual({
      ok: true,
      value: { id: walletId, address, chains: [testChain.ref] },
    });
  });

  it("accepts rules in another order with Privy's ids, a quorum of one with no threshold, a key in lines", () => {
    const reordered = { rules: rules.map(echoed).toReversed() };
    expect(checkWallet(view({ policy: reordered }), expected)).toMatchObject({ ok: true });
    const brokenKey = `${ownerKey.slice(0, 64)}\n${ownerKey.slice(64)}`;
    const relaxed = view({ owner: { threshold: null } });
    expect(checkWallet(relaxed, { ...expected, ownerKey: brokenKey })).toMatchObject({ ok: true });
  });

  const otherRules = rules.slice(1);
  const loosened = rules.map((rule, n) =>
    n === 0
      ? (JSON.parse(
          JSON.stringify(rule).replace("0xde0b6b3a7640000", "0xde0b6b3a7640001"),
        ) as JsonValue)
      : rule,
  );
  const cases: readonly (readonly [string, Parameters<typeof view>[0], ReadBackProblem])[] = [
    ["is no Ethereum wallet", { wallet: { chainType: "solana" } }, "not_ethereum"],
    ["has a malformed address", { wallet: { address: "0x12" } }, "not_ethereum"],
    ["has no owner", { wallet: { ownerId: null } }, "owner"],
    ["is owned by another key", { owner: { publicKeys: [agentKey] } }, "owner"],
    ["is owned by a quorum of two keys", { owner: { publicKeys: [ownerKey, agentKey] } }, "owner"],
    ["is owned by a quorum that needs two signatures", { owner: { threshold: 2 } }, "owner"],
    ["is owned by a quorum with a Privy user in it", { owner: { userIds: ["user"] } }, "owner"],
    ["is owned by a quorum with a nested quorum", { owner: { memberQuorums: ["other"] } }, "owner"],
    ["has a signer with another key", { agent: { publicKeys: [ownerKey] } }, "signer"],
    ["has no added signer", { wallet: { signers: [] } }, "signer"],
    [
      "has a second added signer",
      { wallet: { signers: [...wallet.signers, { signerId: ownerId, overridePolicyIds: null }] } },
      "signer",
    ],
    [
      "has a signer bound by no override policy",
      { wallet: { signers: [{ signerId: agentId, overridePolicyIds: null }] } },
      "signer",
    ],
    [
      "has a signer whose quorum Privy does not hold",
      { wallet: { signers: [{ signerId: id("gone"), overridePolicyIds: [policyId] }] } },
      "signer",
    ],
    ["has no policy of its own", { wallet: { policyIds: [] } }, "policy"],
    [
      "has another policy than its signer's",
      { wallet: { policyIds: [id("otherpolicy")] } },
      "policy",
    ],
    [
      "has a signer bound by another policy than the wallet's",
      { wallet: { signers: [{ signerId: agentId, overridePolicyIds: [id("otherpolicy")] }] } },
      "policy",
    ],
    ["has a policy anyone with the app secret may change", { policy: { ownerId: null } }, "policy"],
    ["has a policy with a rule missing", { policy: { rules: otherRules } }, "policy"],
    [
      "has a policy with a rule added",
      { policy: { rules: [...rules, rules[0] ?? null] } },
      "policy",
    ],
    ["has a policy with a higher cap", { policy: { rules: loosened } }, "policy"],
    [
      "has a policy with a rule Privy wrote in another shape",
      { policy: { rules: [...rules.slice(1), { name: "x" }] } },
      "policy",
    ],
    ["has a policy for another chain type", { policy: { chainType: "solana" } }, "policy"],
  ];

  it.each(cases)("fails a wallet that %s", (_, change, problem) => {
    expect(checkWallet(view(change), expected)).toStrictEqual({ ok: false, error: problem });
  });

  it("fails a wallet whose policy Privy does not hold", () => {
    const missing = { ...view(), policies: new Map<PrivyId, PrivyPolicy>() };
    expect(checkWallet(missing, expected)).toStrictEqual({ ok: false, error: "policy" });
  });
});

describe("readBackWallet", () => {
  it("answers not_found for a wallet Privy does not hold", async () => {
    const { api } = createFakeCustodySubject();
    const found = await readBackWallet(
      api,
      { wallet: id("nosuchwallet"), expected },
      { signal: new AbortController().signal },
    );
    expect(found).toStrictEqual({ ok: false, error: "not_found" });
  });
});
