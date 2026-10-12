import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { ModelChain } from "../loop/ports.js";

/** A fresh chain, the cooldown it rests a provider for, and a way to move its clock. */
export interface ModelChainSubject {
  readonly chain: ModelChain;
  readonly cooldownMs: number;
  readonly advance: (delayMs: number) => Promise<void>;
}

/** Makes a fresh {@link ModelChainSubject} for each check. */
export interface ModelChainHarness {
  create(): Promise<ModelChainSubject>;
}

function firstOf(chain: ModelChain): string {
  const first = chain.models[0];
  assert.ok(first !== undefined, "a chain holds at least one model");
  return first.name;
}

async function restsForTheCooldown(harness: ModelChainHarness): Promise<void> {
  const { chain, cooldownMs, advance } = await harness.create();
  const model = firstOf(chain);
  assert.equal(chain.resting(model), false);
  chain.rest(model, 0);
  assert.equal(chain.resting(model), true);
  await advance(cooldownMs - 1);
  assert.equal(chain.resting(model), true);
  await advance(1);
  assert.equal(chain.resting(model), false);
}

async function restsAsLongAsAsked(harness: ModelChainHarness): Promise<void> {
  const { chain, cooldownMs, advance } = await harness.create();
  const model = firstOf(chain);
  chain.rest(model, cooldownMs + 5_000);
  await advance(cooldownMs + 4_999);
  assert.equal(chain.resting(model), true);
  await advance(1);
  assert.equal(chain.resting(model), false);
}

/**
 * The contract every {@link ModelChain} keeps (runtime spec, section 8.2): it holds a model, a
 * provider it rests stays resting for the cooldown and no longer, and a longer wait the provider
 * asked for is kept.
 */
export function modelChainContract(harness: ModelChainHarness): readonly ContractCheck[] {
  return [
    {
      name: "rests a provider for the cooldown and no longer",
      run: async () => restsForTheCooldown(harness),
    },
    {
      name: "rests a provider as long as it asked when that is longer",
      run: async () => restsAsLongAsAsked(harness),
    },
  ];
}
