import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { QuotaSource } from "../ports.js";
import { quotasSchema } from "../quotas/quotas.js";
import { assertRefusesAborted, checkOn, live } from "./store-fixtures.js";

/** Makes a quota source with the quotas its adapter's test put in force. */
export interface QuotaSourceHarness {
  create(): Promise<QuotaSource>;
}

async function answersWholeNumbers(source: QuotaSource): Promise<void> {
  const quotas = await source.read(live());
  assert.deepEqual(quotasSchema.parse(quotas), quotas);
}

async function answersTheSameTwice(source: QuotaSource): Promise<void> {
  assert.deepEqual(await source.read(live()), await source.read(live()));
}

async function refusesAborted(source: QuotaSource): Promise<void> {
  await assertRefusesAborted(async (options) => source.read(options));
}

/** The contract every `QuotaSource` adapter passes (decision 0431). */
export function quotaSourceContract(harness: QuotaSourceHarness): readonly ContractCheck[] {
  const create = async () => harness.create();
  return [
    checkOn("answers quotas of whole numbers of at least 0", create, answersWholeNumbers),
    checkOn("answers the same quotas while none changed", create, answersTheSameTwice),
    checkOn("refuses a read on an aborted signal", create, refusesAborted),
  ];
}
