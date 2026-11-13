import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import { breakerStateSchema } from "../breaker/breaker-state.js";
import type { BreakerSource } from "../ports.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

async function answersAState(source: BreakerSource): Promise<void> {
  const state = await source.read(live());
  assert.deepEqual(breakerStateSchema.parse(state), state);
}

async function answersTheSameTwice(source: BreakerSource): Promise<void> {
  assert.deepEqual(await source.read(live()), await source.read(live()));
}

async function refusesAborted(source: BreakerSource): Promise<void> {
  await assertRefusesAborted(async (options) => source.read(options));
}

/**
 * The contract every `BreakerSource` adapter passes (decision 0439): it answers a state with a
 * whole version, the same state while nothing moved, and refuses an aborted read. An adapter that
 * answers from a copy also rejects once its copy is older than 10 seconds, which its own tests hold.
 */
export function breakerSourceContract(harness: {
  /** Makes a breaker source in the state its adapter's test put in force. */
  readonly create: () => Promise<BreakerSource>;
}): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("answers a state with a version of at least 0", create, answersAState),
    checkOn("answers the same state while the breaker did not move", create, answersTheSameTwice),
    checkOn("refuses a read on an aborted signal", create, refusesAborted),
  ];
}
