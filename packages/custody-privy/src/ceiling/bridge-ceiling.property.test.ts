import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { depositV3Data } from "../testing/bridge-fixtures.js";
import { bridgeAddresses, testBridgeCeilingRequest } from "../testing/bridge-target-fixtures.js";
import { testAddresses } from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

const wallet = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const { spokePool, bscUsdc, bscEth, baseUsdc, ethereumUsdc, robinhoodWeth } = bridgeAddresses;
const { baseSaved, robinhoodSaved, rescue } = bridgeAddresses;
const { unsaved, unlisted, token } = testAddresses;

// Decisions 0091, 0297 and 0302, read directly and apart from the builder: on each destination the
// owner named, the addresses saved for it and the tokens its routes take and deliver.
const destinations: ReadonlyMap<
  bigint,
  {
    readonly saved: readonly string[];
    readonly tokensIn: readonly string[];
    readonly tokensOut: readonly string[];
  }
> = new Map([
  [8453n, { saved: [baseSaved], tokensIn: [bscUsdc], tokensOut: [baseUsdc] }],
  [4663n, { saved: [robinhoodSaved], tokensIn: [bscEth], tokensOut: [robinhoodWeth] }],
  [1n, { saved: [rescue], tokensIn: [bscUsdc], tokensOut: [ethereumUsdc] }],
]);

interface Deposit {
  readonly to: string;
  readonly valueWei: bigint;
  readonly depositor: string;
  readonly recipient: string;
  readonly chain: bigint;
  readonly tokenIn: string;
  readonly tokenOut: string;
  readonly message: `0x${string}`;
}

// A deposit is safe when it pays an address saved for its destination, refunds the wallet, carries
// no coin and moves a token a route to that destination moves. Its message is the signer's to check:
// Privy takes no condition for an empty `bytes` value.
function isSafe(deposit: Deposit): boolean {
  const target = destinations.get(deposit.chain);
  return (
    target !== undefined &&
    deposit.to === spokePool &&
    deposit.valueWei === 0n &&
    deposit.depositor === wallet &&
    target.saved.includes(deposit.recipient) &&
    target.tokensIn.includes(deposit.tokenIn) &&
    target.tokensOut.includes(deposit.tokenOut)
  );
}

const accounts = fc.constantFrom(baseSaved, robinhoodSaved, rescue, unsaved, wallet, spokePool);
const tokens = fc.constantFrom(bscUsdc, bscEth, baseUsdc, ethereumUsdc, robinhoodWeth, token);
const deposits: fc.Arbitrary<Deposit> = fc.record({
  to: fc.constantFrom(spokePool, spokePool, unlisted),
  valueWei: fc.constantFrom(0n, 0n, 1n),
  depositor: fc.constantFrom(wallet, wallet, unsaved),
  recipient: accounts,
  chain: fc.constantFrom(8453n, 4663n, 1n, 10n, 56n, 42161n, 34_268_394_551_451n),
  tokenIn: tokens,
  tokenOut: tokens,
  message: fc.constantFrom<`0x${string}`>("0x", "0x", "0x01"),
});

const built = buildCeiling(testBridgeCeilingRequest());
const rules = built.ok
  ? fakePolicyBodySchema.parse({
      version: "1.0",
      name: "binference ceiling",
      chain_type: "ethereum",
      rules: built.value.rules.map(policyRuleJson),
    }).rules
  : [];

describe("bridge deposits under the ceiling", () => {
  it("allows a deposit exactly when it pays an address saved for its chain, on a route", () => {
    expect(built.ok).toBe(true);
    fc.assert(
      fc.property(deposits, (deposit) => {
        const data = depositV3Data({
          depositor: deposit.depositor as `0x${string}`,
          recipient: deposit.recipient as `0x${string}`,
          inputToken: deposit.tokenIn as `0x${string}`,
          outputToken: deposit.tokenOut as `0x${string}`,
          destinationChainId: deposit.chain,
          message: deposit.message,
        });
        const verdict = evaluatePolicy(rules, {
          method: "eth_signTransaction",
          to: deposit.to,
          valueWei: deposit.valueWei,
          chainId: 56n,
          data,
          walletAddress: wallet,
        });
        expect(verdict === "ALLOW").toBe(isSafe(deposit));
      }),
      { numRuns: 3_000 },
    );
  });
});
