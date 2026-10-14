import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  approvalForAllData,
  approveData,
  curveData,
  oneBnbWei,
  swapData,
  swapToData,
  sweepData,
  testAddresses,
  testCaps,
  testCeilingRequest,
  testLaunchCeilingRequest,
  transferData,
} from "../testing/custody-fixtures.js";
import { evaluatePolicy, type FakeReferences } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema, type FakeRule } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { CeilingRequest } from "./ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

const { router, permit2, rescue, saved, unsaved, token, unlisted, curve } = testAddresses;
const wallet = "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48";
// The agent's main wallet beside its launch wallet `wallet`, which neither saved.
const mainWallet = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
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

function ceilingRules(request: CeilingRequest = testCeilingRequest()): readonly FakeRule[] {
  const ceiling = buildCeiling(request);
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

/** A launch call or an approval a launch wallet's ceiling may allow, or anything else. */
type LaunchData =
  | { readonly kind: "curve"; readonly side: "buy" | "sell"; readonly recipient: string }
  | { readonly kind: "approve"; readonly spender: string; readonly amount: bigint }
  | { readonly kind: "approvalForAll"; readonly operator: string }
  | { readonly kind: "transfer"; readonly to: string }
  | { readonly kind: "other"; readonly hex: `0x${string}` };

interface LaunchTx {
  readonly chainId: bigint;
  readonly to: string;
  readonly valueWei: bigint;
  readonly data: LaunchData;
  /** The wallet that signs: the launch wallet, or the agent's main wallet. */
  readonly signer: string;
}

const launchDataOf: {
  readonly [K in LaunchData["kind"]]: (item: Extract<LaunchData, { kind: K }>) => `0x${string}`;
} = {
  curve: (item) => curveData(item.side, item.recipient),
  approve: (item) => approveData(item.spender, item.amount),
  approvalForAll: (item) => approvalForAllData(item.operator),
  transfer: (item) => transferData(item.to, 5n),
  other: (item) => item.hex,
};

function launchHexOf(item: LaunchData): `0x${string}` {
  return (launchDataOf[item.kind] as (each: LaunchData) => `0x${string}`)(item);
}

// The 24-hour sums after a launch transaction, as the test's two aggregations count it.
function launchSums(tx: LaunchTx, held: Held): Held {
  const onChain = tx.chainId === 56n;
  const approved = tx.data.kind === "approve" && tx.to === token ? tx.data.amount : 0n;
  return {
    native: held.native + (onChain ? tx.valueWei : 0n),
    token: held.token + (onChain ? approved : 0n),
  };
}

// A curve's call paying the launch wallet, within the cap per call and the native day cap.
function isAllowedCurveCall(tx: LaunchTx, after: Held): boolean {
  const { data: call } = tx;
  const paysWallet = call.kind === "curve" && call.recipient === wallet;
  return paysWallet && tx.valueWei <= oneBnbWei && after.native <= nativeCap;
}

// An approval with no coin, naming any spender, within the token's day cap.
function isAllowedApproval(tx: LaunchTx, after: Held): boolean {
  const capped = after.token <= (tokenCap?.limitBase ?? 0n);
  return tx.data.kind === "approve" && tx.valueWei === 0n && capped;
}

// A send, a token send or the self-cancel, as every ceiling allows them.
function isAllowedSend(tx: LaunchTx): boolean {
  const { data: call } = tx;
  const isTransfer = call.kind === "transfer" && tx.valueWei === 0n && recipients.has(call.to);
  return recipients.has(tx.to) || (tx.to === wallet && tx.valueWei === 0n) || isTransfer;
}

// Decision 0217, read directly: on the launch wallet a curve's `buy` or `sell` on any contract
// paying the wallet itself, and an `approve` naming any spender, each under the caps; a send only
// to the rescue address or a saved address, and the self-cancel. The main wallet's ceiling holds
// no launch rule.
function launchSpecAllows(tx: LaunchTx, held: Held): boolean {
  if (tx.chainId !== 56n || tx.signer !== wallet) {
    return false;
  }
  const after = launchSums(tx, held);
  return isAllowedSend(tx) || isAllowedCurveCall(tx, after) || isAllowedApproval(tx, after);
}

const launchAccounts = fc.constantFrom(
  curve,
  router,
  unlisted,
  token,
  rescue,
  saved,
  unsaved,
  wallet,
  mainWallet,
);
const launchData: fc.Arbitrary<LaunchData> = fc.oneof(
  fc.record({
    kind: fc.constant("curve" as const),
    side: fc.constantFrom("buy" as const, "sell" as const),
    recipient: launchAccounts,
  }),
  fc.record({ kind: fc.constant("approve" as const), spender: launchAccounts, amount: amounts }),
  launchAccounts.map((operator) => ({ kind: "approvalForAll" as const, operator })),
  launchAccounts.map((to) => ({ kind: "transfer" as const, to })),
  fc.uint8Array({ minLength: 4, maxLength: 100 }).map((bytes) => ({
    kind: "other" as const,
    hex: `0x${Buffer.from(bytes).toString("hex")}` as const,
  })),
);

// Whether a transaction is one only a launch rule could allow: a curve call, or an approval of a
// spender the agent's venues do not declare, to no address a send or a cancel may pay.
function isLaunchOnly(tx: LaunchTx): boolean {
  const { data: call } = tx;
  const reachesSend = recipients.has(tx.to) || tx.to === tx.signer;
  const isLaunchApproval = call.kind === "approve" && call.spender !== router;
  return !reachesSend && tx.to !== router && (call.kind === "curve" || isLaunchApproval);
}

const launchTransactions = (signer: string): fc.Arbitrary<LaunchTx> =>
  fc
    .record({
      chainId: fc.constantFrom(56n, 1n),
      to: launchAccounts,
      valueWei: values,
      data: launchData,
      signer: fc.constant(signer),
    })
    .filter(isLaunchOnly);

// The rules that bind the signing wallet: the launch wallet's ceiling, or the main wallet's.
const launchRules = ceilingRules(testLaunchCeilingRequest());
const mainRules = ceilingRules();

function verdictOf(tx: LaunchTx, held: Held): string {
  const after = launchSums(tx, held);
  const references: FakeReferences = (aggregation) => {
    if (aggregation === testCaps.native.aggregation) {
      return after.native;
    }
    return aggregation === tokenCap?.aggregation ? after.token : undefined;
  };
  const input = {
    method: "eth_signTransaction",
    to: tx.to,
    valueWei: tx.valueWei,
    chainId: tx.chainId,
    data: launchHexOf(tx.data),
    walletAddress: tx.signer,
  };
  return evaluatePolicy(tx.signer === wallet ? launchRules : mainRules, input, references);
}

const noneHeld: Held = { native: 0n, token: 0n };

// A curve's call from the signer, with one wei, paying the recipient.
function curveCallVerdict(side: "buy" | "sell", recipient: string, signer = wallet): string {
  const call = { kind: "curve", side, recipient } as const;
  return verdictOf({ chainId: 56n, to: curve, valueWei: 1n, data: call, signer }, noneHeld);
}

// A plain send of the coin from the launch wallet; what pays it decides.
function sendVerdict(to: string, valueWei: bigint, held: Held): string {
  const call = { kind: "other", hex: "0x00000000" } as const;
  return verdictOf({ chainId: 56n, to, valueWei, data: call, signer: wallet }, held);
}

// Whether a send from the launch wallet pays an address its ceiling lets it pay.
const isPayee = (to: string, valueWei: bigint): boolean =>
  recipients.has(to) || (to === wallet && valueWei === 0n);

// Whether an account is one a send from the launch wallet may pay with no coin.
const isZeroValuePayee = (to: string): boolean => isPayee(to, 0n);

describe("a launch wallet's ceiling under Privy's policy semantics", () => {
  it("allows a curve call or an approval exactly as decision 0217 does, on the launch wallet", () => {
    fc.assert(
      fc.property(launchTransactions(wallet), helds, (tx, held) => {
        expect(verdictOf(tx, held) === "ALLOW").toBe(launchSpecAllows(tx, held));
      }),
      { numRuns: 2_000 },
    );
  });

  it("allows a curve buy and sell paying the launch wallet, and the same paying another", () => {
    expect([curveCallVerdict("buy", wallet), curveCallVerdict("sell", wallet)]).toStrictEqual([
      "ALLOW",
      "ALLOW",
    ]);
    expect([curveCallVerdict("buy", unsaved), curveCallVerdict("sell", mainWallet)]).toStrictEqual([
      "DENY",
      "DENY",
    ]);
    expect([
      curveCallVerdict("buy", mainWallet, mainWallet),
      curveCallVerdict("sell", mainWallet, mainWallet),
    ]).toStrictEqual(["DENY", "DENY"]);
  });

  it("refuses the main wallet every curve call and approval only a launch rule allows", () => {
    fc.assert(
      fc.property(launchTransactions(mainWallet), helds, (tx, held) => {
        expect(verdictOf(tx, held)).toBe("DENY");
      }),
    );
  });

  it("sends from the launch wallet only to the rescue address or a saved address", () => {
    fc.assert(
      fc.property(launchAccounts, values, helds, (to, valueWei, held) => {
        expect(sendVerdict(to, valueWei, held) === "ALLOW").toBe(isPayee(to, valueWei));
      }),
    );
  });

  it("refuses an approval through any function but the declared approve", () => {
    fc.assert(
      fc.property(launchAccounts, launchAccounts, helds, (to, operator, held) => {
        const approval = { kind: "approvalForAll", operator } as const;
        const tx = { chainId: 56n, to, valueWei: 0n, data: approval, signer: wallet };
        expect(verdictOf(tx, held) === "ALLOW").toBe(isZeroValuePayee(to));
      }),
    );
  });
});
