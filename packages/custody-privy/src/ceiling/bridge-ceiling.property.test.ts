import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { depositV3Data } from "../testing/bridge-fixtures.js";
import {
  bridgeAddresses,
  testBridgeCall,
  testBridgeCeilingRequest,
} from "../testing/bridge-target-fixtures.js";
import { testAddresses, testCaps } from "../testing/custody-fixtures.js";
import { evaluatePolicy } from "../testing/fake-policy-engine.js";
import { fakePolicyBodySchema, type FakeRule } from "../testing/fake-privy-request.schema.js";
import { buildCeiling } from "./build-ceiling.js";
import type { BridgeDeposit } from "./ceiling.js";
import { policyRuleJson } from "./policy-rule.js";

type Hex = `0x${string}`;

const wallet: Hex = "0x6B175474E89094C44Da98b954EedeAC495271d0F";
const { spokePool, bscUsdc, bscEth, baseUsdc, ethereumUsdc, ethereumWeth, robinhoodWeth } =
  bridgeAddresses;
const { baseSaved, robinhoodSaved, rescue } = bridgeAddresses;
const { unsaved, unlisted } = testAddresses;

const people: readonly Hex[] = [baseSaved, robinhoodSaved, rescue, unsaved, wallet];
const tokens: readonly Hex[] = [
  bscUsdc,
  bscEth,
  baseUsdc,
  ethereumUsdc,
  ethereumWeth,
  robinhoodWeth,
];
const chains: readonly bigint[] = [8453n, 4663n, 1n, 10n, 56n];

/** A destination the generated ceiling serves, as the oracle reads it. */
interface Destination {
  readonly chain: bigint;
  readonly saved: readonly Hex[];
  readonly pairs: readonly (readonly [Hex, Hex])[];
}

interface Deposit {
  readonly to: string;
  readonly valueWei: bigint;
  readonly depositor: Hex;
  readonly recipient: Hex;
  readonly chain: bigint;
  readonly tokenIn: Hex;
  readonly tokenOut: Hex;
  readonly message: Hex;
}

const same = (left: string, right: string): boolean => left.toLowerCase() === right.toLowerCase();

/** An address the owner saved for one chain. */
interface SavedAddress {
  readonly chain: bigint;
  readonly address: Hex;
}

/** A generated ceiling: its destinations, and the addresses it saves, each for its chain. */
interface Ceiling {
  readonly destinations: readonly Destination[];
  readonly saved: readonly SavedAddress[];
}

// Decisions 0091, 0297, 0302 and 0313, read directly and apart from the builder: a deposit is safe
// when it pays an address named for its destination that is still saved for that chain, refunds
// the wallet, carries no coin, and moves one of that destination's routes as its pair of tokens.
// Its message is the signer's to check: Privy takes no condition for an empty `bytes` value.
function isSafe(ceiling: Ceiling, deposit: Deposit): boolean {
  const place = ceiling.destinations.find((item) => item.chain === deposit.chain);
  const sendable = ceiling.saved.some(
    (item) => item.chain === deposit.chain && same(item.address, deposit.recipient),
  );
  return (
    place !== undefined &&
    sendable &&
    same(deposit.to, spokePool) &&
    deposit.valueWei === 0n &&
    same(deposit.depositor, wallet) &&
    place.saved.some((address) => same(address, deposit.recipient)) &&
    place.pairs.some(
      ([tokenIn, tokenOut]) => same(tokenIn, deposit.tokenIn) && same(tokenOut, deposit.tokenOut),
    )
  );
}

// An address as the owner may have typed it: in its checksum or all in lowercase.
const anyCase = (address: Hex) => fc.constantFrom(address, address.toLowerCase() as Hex);

const destinations: fc.Arbitrary<readonly Destination[]> = fc.uniqueArray(
  fc.record({
    chain: fc.constantFrom(8453n, 4663n, 1n),
    saved: fc.uniqueArray(fc.constantFrom(...people), { minLength: 1, maxLength: 3 }),
    pairs: fc.uniqueArray(fc.tuple(fc.constantFrom(...tokens), fc.constantFrom(...tokens)), {
      minLength: 1,
      maxLength: 2,
      selector: ([tokenIn, tokenOut]) => `${tokenIn}${tokenOut}`,
    }),
  }),
  { maxLength: 3, selector: (place) => place.chain },
);

const ceilings: fc.Arbitrary<Ceiling> = fc.record({
  destinations,
  saved: fc.uniqueArray(
    fc.record({
      chain: fc.constantFrom(8453n, 4663n, 1n, 56n),
      address: fc.constantFrom(...people),
    }),
    { maxLength: 6, selector: (item) => `${String(item.chain)} ${item.address}` },
  ),
});

// The fake's rules for a generated ceiling, each address typed in the case given.
function rulesFor(chosen: Ceiling, typed: (address: Hex) => string): readonly FakeRule[] {
  const deposits: readonly BridgeDeposit[] = chosen.destinations.map((place) => ({
    call: testBridgeCall,
    destinationChainId: String(place.chain),
    routes: place.pairs.map(([tokenIn, tokenOut]) => ({
      tokenIn: typed(tokenIn),
      tokenOut: typed(tokenOut),
    })),
  }));
  const bridged = chosen.destinations.map((place) => ({
    chainId: String(place.chain),
    addresses: place.saved.map(typed),
  }));
  // Every token of the pools carries a cap, so the routes' tokens always have one.
  const routeCaps = tokens.map((token, index) => ({
    aggregation: `testcaproute${String(index).padStart(13, "0")}`,
    limitBase: 1_000n,
    token,
  }));
  const request = testBridgeCeilingRequest(testCaps, routeCaps);
  const built = buildCeiling({
    ...request,
    saved: chosen.saved.map((item) => ({
      chainId: String(item.chain),
      addresses: [typed(item.address)],
    })),
    bridged,
    chains: request.chains.map((chain) => Object.assign({}, chain, { bridges: deposits })),
  });
  if (!built.ok) {
    throw new Error(built.error);
  }
  return fakePolicyBodySchema.parse({
    version: "1.0",
    name: "binference ceiling",
    chain_type: "ethereum",
    rules: built.value.rules.map(policyRuleJson),
  }).rules;
}

// Addresses typed as given, or all in lowercase.
const typings: Readonly<Record<"asGiven" | "lowercase", (address: Hex) => string>> = {
  asGiven: (address) => address,
  lowercase: (address) => address.toLowerCase(),
};

const deposits: fc.Arbitrary<Deposit> = fc.record({
  to: fc.constantFrom(spokePool, spokePool, unlisted),
  valueWei: fc.constantFrom(0n, 0n, 1n),
  depositor: fc.constantFrom(wallet, wallet, unsaved),
  recipient: fc.constantFrom(...people).chain(anyCase),
  chain: fc.constantFrom(...chains),
  tokenIn: fc.constantFrom(...tokens),
  tokenOut: fc.constantFrom(...tokens),
  message: fc.constantFrom<Hex>("0x", "0x", "0x01"),
});

function verdictOf(rules: readonly FakeRule[], deposit: Deposit): boolean {
  const data = depositV3Data({
    depositor: deposit.depositor,
    recipient: deposit.recipient,
    inputToken: deposit.tokenIn,
    outputToken: deposit.tokenOut,
    destinationChainId: deposit.chain,
    message: deposit.message,
  });
  const input = { method: "eth_signTransaction", to: deposit.to, valueWei: deposit.valueWei };
  const request = { ...input, chainId: 56n, data, walletAddress: wallet };
  return evaluatePolicy(rules, request) === "ALLOW";
}

describe("bridge deposits under any ceiling of saved addresses, recipients and routes", () => {
  it("allows a deposit exactly when it pays an address saved for its chain, on one route", () => {
    const typing = fc.constantFrom("asGiven" as const, "lowercase" as const);
    fc.assert(
      fc.property(ceilings, typing, deposits, (chosen, typed, deposit) => {
        expect(verdictOf(rulesFor(chosen, typings[typed]), deposit)).toBe(isSafe(chosen, deposit));
      }),
      { numRuns: 2_000 },
    );
  });

  it("never pays a mixed pair: a token that leaves on one route with the token of another", () => {
    const pairs = [
      [bscUsdc, ethereumUsdc],
      [bscEth, ethereumWeth],
    ] as const;
    const ceiling = {
      destinations: [{ chain: 1n, saved: [rescue], pairs }],
      saved: [{ chain: 1n, address: rescue }],
    };
    const rules = rulesFor(ceiling, (address) => address);
    const base = {
      to: spokePool,
      valueWei: 0n,
      depositor: wallet,
      recipient: rescue,
      chain: 1n,
      message: "0x" as Hex,
    };
    expect(verdictOf(rules, { ...base, tokenIn: bscEth, tokenOut: ethereumWeth })).toBe(true);
    expect(verdictOf(rules, { ...base, tokenIn: bscEth, tokenOut: ethereumUsdc })).toBe(false);
  });
});
