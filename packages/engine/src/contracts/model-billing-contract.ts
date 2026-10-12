import assert from "node:assert/strict";
import type { Id } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { ModelCharge } from "../billing/model-charge.js";
import type { ModelBilling } from "../ports.js";
import { assertRefusesAborted, fixtureId, live } from "./store-fixtures.js";

/**
 * Makes a billing where each agent may spend the given micro-dollars today, and nothing has been
 * charged yet. Agents left out have nothing to spend.
 */
export interface ModelBillingHarness {
  create(allowances: ReadonlyMap<Id<"agt">, bigint>): Promise<ModelBilling>;
}

const first = fixtureId("agt", 1);
const second = fixtureId("agt", 2);
const dollars = (n: bigint): bigint => n * 1_000_000n;

const turn = fixtureId("trn", 1);
let attempts = 0;

// One attempt of a model call, under a key of its own unless the check names one.
const charge = (agent: Id<"agt">, usdMicros: bigint, key?: string): ModelCharge => {
  attempts += 1;
  return {
    agent,
    turn,
    key: key ?? `${turn}.usage.${String(attempts)}`,
    model: "main-model",
    inputTokens: 1_000,
    outputTokens: 100,
    cachedTokens: 0,
    usdMicros,
    atMs: 1_800_000_000_000,
  };
};

async function threeDollarsEach(harness: ModelBillingHarness): Promise<ModelBilling> {
  return harness.create(
    new Map([
      [first, dollars(3n)],
      [second, dollars(3n)],
    ]),
  );
}

const spendChecks = (harness: ModelBillingHarness): readonly ContractCheck[] => [
  {
    name: "answers each agent's allowance before any charge",
    run: async () => {
      const billing = await harness.create(
        new Map([
          [first, dollars(3n)],
          [second, dollars(5n)],
        ]),
      );
      assert.equal(await billing.left(first, live()), dollars(3n));
      assert.equal(await billing.left(second, live()), dollars(5n));
    },
  },
  {
    name: "lowers what is left by the exact cost of each charge",
    run: async () => {
      const billing = await threeDollarsEach(harness);
      assert.equal(await billing.charge(charge(first, 1_250_001n), live()), 1_749_999n);
      assert.equal(await billing.charge(charge(first, 0n), live()), 1_749_999n);
      assert.equal(await billing.left(first, live()), 1_749_999n);
    },
  },
  {
    name: "charges an attempt sent twice under its key once",
    run: async () => {
      const billing = await threeDollarsEach(harness);
      const key = `${turn}.usage.1`;
      assert.equal(await billing.charge(charge(first, dollars(1n), key), live()), dollars(2n));
      assert.equal(await billing.charge(charge(first, dollars(1n), key), live()), dollars(2n));
      assert.equal(await billing.left(first, live()), dollars(2n));
    },
  },
  {
    name: "answers 0, never less, once the charges pass what is left",
    run: async () => {
      const billing = await threeDollarsEach(harness);
      assert.equal(await billing.charge(charge(first, dollars(4n)), live()), 0n);
      assert.equal(await billing.left(first, live()), 0n);
    },
  },
];

const apartChecks = (harness: ModelBillingHarness): readonly ContractCheck[] => [
  {
    name: "charges one agent without touching another's allowance",
    run: async () => {
      const billing = await threeDollarsEach(harness);
      await billing.charge(charge(first, dollars(2n)), live());
      assert.equal(await billing.left(second, live()), dollars(3n));
    },
  },
  {
    name: "answers and charges nothing on an aborted signal",
    run: async () => {
      const billing = await threeDollarsEach(harness);
      await assertRefusesAborted(async (options) => billing.left(first, options));
      await assertRefusesAborted(async (options) => billing.charge(charge(first, 1n), options));
      assert.equal(await billing.left(first, live()), dollars(3n));
    },
  },
];

/** The contract every `ModelBilling` adapter passes. */
export function modelBillingContract(harness: ModelBillingHarness): readonly ContractCheck[] {
  return [...spendChecks(harness), ...apartChecks(harness)];
}
