import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  approvalForAllData,
  approveData,
  oneBnbWei,
  swapData,
  swapToData,
  sweepData,
  testAddresses,
  testCaps,
  testCeilingRequest,
  transferData,
} from "../testing/custody-fixtures.js";
import { evaluatePolicy, type FakeReferences } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema, type FakeRule } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

const { router, permit2, rescue, saved, unsaved, token, unlisted } = testAddresses;
const wallet = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
const recipients: ReadonlySet<string> = new Set([rescue, saved]);
const nativeCap = testCaps.native.limitBase;
const [tokenCap] = testCaps.approvals;

type Data =
  | { readonly kind: "none" }
  | { readonly kind: "approve"; readonly spender: string; readonly amount: bigint }
  | { readonly kind: "transfer"; readonly to: string }
  | { readonly kind: "approvalForAll"; readonly operator: string }
  | { readonly kind: "swap" }
  | { readonly kind: "swapTo"; readonly receiver: string }
  | { readonly kind: "sweep"; readonly to: string }
  | { readonly kind: "other"; readonly hex: `0x${string}` };

interface Tx {
  readonly chainId: bigint;
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: Data;
}

/** What the 24-hour sums held before the transaction, as Privy reads them. */
interface Held {
  readonly native: bigint;
  readonly token: bigint;
}

const dataOf: {
  readonly [K in Data["kind"]]: (data: Extract<Data, { kind: K }>) => `0x${string}`;
} = {
  none: () => "0x",
  approve: (data) => approveData(data.spender, data.amount),
  transfer: (data) => transferData(data.to, 5n),
  approvalForAll: (data) => approvalForAllData(data.operator),
  swap: () => swapData(5n),
  swapTo: (data) => swapToData(data.receiver, 5n),
  sweep: (data) => sweepData(token, data.to),
  other: (data) => data.hex,
};

function hexOf(data: Data): `0x${string}` {
  return (dataOf[data.kind] as (item: Data) => `0x${string}`)(data);
}

// What the native aggregation counts: every value sent on chain 56. The token's: every approval
// sent to the token on chain 56.
function sums(tx: Tx, held: Held): Held {
  const onChain = tx.chainId === 56n;
  const approved = tx.data.kind === "approve" && tx.to === token ? tx.data.amount : 0n;
  return {
    native: held.native + (onChain ? tx.valueWei : 0n),
    token: held.token + (onChain ? approved : 0n),
  };
}

// Spec 5, section 4 and decision 0149, read directly: the reference the built ceiling must agree
// with. A venue call is the router's `swap`, or its `swapTo` paying the wallet itself.
function venueCallAllowed(tx: Tx, after: Held): boolean {
  const { data } = tx;
  const listed = data.kind === "swap" || (data.kind === "swapTo" && data.receiver === wallet);
  return tx.to === router && listed && tx.valueWei <= oneBnbWei && after.native <= nativeCap;
}

function tokenCallAllowed(tx: Tx, after: Held): boolean {
  if (tx.valueWei !== 0n) {
    return false;
  }
  const { data } = tx;
  const approval = data.kind === "approve" && data.spender === router;
  const capped = after.token <= (tokenCap?.limitBase ?? 0n);
  return (approval && capped) || (data.kind === "transfer" && recipients.has(data.to));
}

function specAllows(tx: Tx, held: Held): boolean {
  if (tx.chainId !== 56n) {
    return false;
  }
  const after = sums(tx, held);
  const cancel = tx.to === wallet && tx.valueWei === 0n;
  const send = recipients.has(tx.to);
  return send || cancel || venueCallAllowed(tx, after) || tokenCallAllowed(tx, after);
}

// The fake's sums for the test's two aggregations, as Privy reads them forward.
function referencesFor(tx: Tx, held: Held): FakeReferences {
  const after = sums(tx, held);
  return (aggregation) => {
    if (aggregation === testCaps.native.aggregation) {
      return after.native;
    }
    return aggregation === tokenCap?.aggregation ? after.token : undefined;
  };
}

const accounts = fc.constantFrom(router, permit2, rescue, saved, unsaved, token, unlisted, wallet);
const amounts = fc.constantFrom(0n, 1n, 999n, 1_000n, 1_001n, 10n ** 24n);
const data: fc.Arbitrary<Data> = fc.oneof(
  fc.constant({ kind: "none" as const }),
  fc.record({ kind: fc.constant("approve" as const), spender: accounts, amount: amounts }),
  accounts.map((to) => ({ kind: "transfer" as const, to })),
  accounts.map((operator) => ({ kind: "approvalForAll" as const, operator })),
  fc.constant({ kind: "swap" as const }),
  accounts.map((receiver) => ({ kind: "swapTo" as const, receiver })),
  accounts.map((to) => ({ kind: "sweep" as const, to })),
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
const helds: fc.Arbitrary<Held> = fc.record({
  native: fc.oneof(
    fc.constantFrom(0n, nativeCap, nativeCap - oneBnbWei),
    fc.bigInt({ min: 0n, max: nativeCap }),
  ),
  token: fc.oneof(fc.constantFrom(0n, 999n, 1_000n), fc.bigInt({ min: 0n, max: 1_000n })),
});

// A venue call or an approval that no send or self-cancel rule allows on its own.
function isCappedCall(tx: Tx): boolean {
  const capped = ["swap", "swapTo", "approve"].includes(tx.data.kind);
  return capped && !recipients.has(tx.to) && tx.to !== wallet;
}

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

  it("allows a transaction exactly when spec 5 section 4 and its 24-hour caps allow it", () => {
    fc.assert(
      fc.property(transactions, helds, (tx, held) => {
        const verdict = evaluatePolicy(
          rules,
          {
            method: "eth_signTransaction",
            to: tx.to,
            valueWei: tx.valueWei,
            chainId: tx.chainId,
            data: hexOf(tx.data),
            walletAddress: wallet,
          },
          referencesFor(tx, held),
        );
        expect(verdict === "ALLOW").toBe(specAllows(tx, held));
      }),
      { numRuns: 2_000 },
    );
  });

  it("allows no venue call and no approval once their aggregations are gone", () => {
    fc.assert(
      fc.property(transactions.filter(isCappedCall), (tx) => {
        const verdict = evaluatePolicy(rules, {
          method: "eth_signTransaction",
          to: tx.to,
          valueWei: tx.valueWei,
          chainId: tx.chainId,
          data: hexOf(tx.data),
          walletAddress: wallet,
        });
        expect(verdict).toBe("DENY");
      }),
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
