import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  approvalForAllData,
  approveData,
  oneBnbWei,
  testAddresses,
  testCeilingRequest,
  transferData,
} from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema, type FakeRule } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

const { router, permit2, rescue, saved, unsaved, token, unlisted } = testAddresses;
const wallet = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const contracts: ReadonlySet<string> = new Set([router, permit2]);
const recipients: ReadonlySet<string> = new Set([rescue, saved]);

type Data =
  | { readonly kind: "none" }
  | { readonly kind: "approve"; readonly spender: string }
  | { readonly kind: "transfer"; readonly to: string }
  | { readonly kind: "approvalForAll"; readonly operator: string }
  | { readonly kind: "other"; readonly hex: `0x${string}` };

interface Tx {
  readonly chainId: bigint;
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: Data;
}

const dataOf: {
  readonly [K in Data["kind"]]: (data: Extract<Data, { kind: K }>) => `0x${string}`;
} = {
  none: () => "0x",
  approve: (data) => approveData(data.spender, 5n),
  transfer: (data) => transferData(data.to, 5n),
  approvalForAll: (data) => approvalForAllData(data.operator),
  other: (data) => data.hex,
};

function hexOf(data: Data): `0x${string}` {
  return (dataOf[data.kind] as (item: Data) => `0x${string}`)(data);
}

// Spec 5, section 4, read directly: the reference the built ceiling must agree with.
function tokenCallAllowed(tx: Tx): boolean {
  if (tx.valueWei !== 0n) {
    return false;
  }
  const { data } = tx;
  const approval = data.kind === "approve" && contracts.has(data.spender);
  return approval || (data.kind === "transfer" && recipients.has(data.to));
}

function specAllows(tx: Tx): boolean {
  // setApprovalForAll has no rule of its own: it passes only where the call itself is allowed.
  if (tx.chainId !== 56n) {
    return false;
  }
  const listedCall = contracts.has(tx.to) && tx.valueWei <= oneBnbWei;
  const cancel = tx.to === wallet && tx.valueWei === 0n;
  return listedCall || recipients.has(tx.to) || cancel || tokenCallAllowed(tx);
}

const accounts = fc.constantFrom(router, permit2, rescue, saved, unsaved, token, unlisted, wallet);
const data: fc.Arbitrary<Data> = fc.oneof(
  fc.constant({ kind: "none" as const }),
  accounts.map((spender) => ({ kind: "approve" as const, spender })),
  accounts.map((to) => ({ kind: "transfer" as const, to })),
  accounts.map((operator) => ({ kind: "approvalForAll" as const, operator })),
  fc.uint8Array({ minLength: 4, maxLength: 68 }).map((bytes) => ({
    kind: "other" as const,
    hex: `0x${Buffer.from(bytes).toString("hex")}` as const,
  })),
);
const values = fc.oneof(
  fc.constantFrom(0n, 1n, oneBnbWei - 1n, oneBnbWei, oneBnbWei + 1n),
  fc.bigInt({ min: 0n, max: 3n * oneBnbWei }),
);
const transactions: fc.Arbitrary<Tx> = fc.record({
  chainId: fc.constantFrom(56n, 1n, 97n),
  to: accounts,
  valueWei: values,
  data,
});

function ceilingRules(): readonly FakeRule[] {
  const ceiling = buildCeiling(testCeilingRequest());
  if (!ceiling.ok) {
    throw new Error(ceiling.error);
  }
  const body = {
    version: "1.0",
    name: "binference ceiling",
    chain_type: "ethereum",
    rules: ceiling.value.rules.map(policyRuleJson),
  };
  return fakePolicyBodySchema.parse(body).rules;
}

describe("the ceiling under Privy's policy semantics", () => {
  const rules = ceilingRules();

  it("allows a transaction exactly when spec 5 section 4 allows it", () => {
    fc.assert(
      fc.property(transactions, (tx) => {
        const verdict = evaluatePolicy(rules, {
          method: "eth_signTransaction",
          to: tx.to,
          valueWei: tx.valueWei,
          chainId: tx.chainId,
          data: hexOf(tx.data),
          walletAddress: wallet,
        });
        expect(verdict === "ALLOW").toBe(specAllows(tx));
      }),
      { numRuns: 2_000 },
    );
  });

  it("allows no other signing method, whatever the transaction", () => {
    fc.assert(
      fc.property(
        transactions,
        fc.constantFrom(
          "personal_sign",
          "eth_signTypedData_v4",
          "eth_sendTransaction",
          "eth_sign7702Authorization",
        ),
        (tx, method) => {
          const verdict = evaluatePolicy(rules, {
            method,
            to: tx.to,
            valueWei: tx.valueWei,
            chainId: tx.chainId,
            data: hexOf(tx.data),
            walletAddress: wallet,
          });
          expect(verdict).toBe("DENY");
        },
      ),
    );
  });
});
