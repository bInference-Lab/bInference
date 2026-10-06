import assert from "node:assert/strict";
import { type Id, idSchema } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { type Sha256Hex, sha256Hex } from "../records/sha256-hex.js";

/** The options of a store call that nothing stops. */
export function live(): { readonly signal: AbortSignal } {
  return { signal: new AbortController().signal };
}

/** A valid id with the given prefix, the same for the same `n`. */
export function fixtureId<P extends string>(prefix: P, n: number): Id<P> {
  return idSchema(prefix).parse(
    `${prefix}_0190f1c2-3a4b-7c5d-8e6f-${n.toString(16).padStart(12, "0")}`,
  );
}

/** The SHA-256 of a fixture text. */
export function fixtureHash(text: string): Sha256Hex {
  return sha256Hex(text);
}

/** A contract check that makes a fresh subject and runs `run` on it. */
export function checkOn<Subject>(
  name: string,
  create: () => Promise<Subject>,
  run: (subject: Subject) => Promise<void>,
): ContractCheck {
  return { name, run: async () => run(await create()) };
}

/** Asserts that a call on an aborted signal rejects with the signal's reason. */
export async function assertRefusesAborted<Output>(
  call: (options: { readonly signal: AbortSignal }) => Promise<Output>,
): Promise<void> {
  const reason = new Error("stopped by the caller");
  await assert.rejects(call({ signal: AbortSignal.abort(reason) }), reason);
}

/** Runs `step` on each item, one after another, and returns the results in order. */
export async function inOrder<Item, Output>(
  items: readonly Item[],
  step: (item: Item) => Promise<Output>,
): Promise<readonly Output[]> {
  return items.reduce<Promise<readonly Output[]>>(
    async (done, item) => [...(await done), await step(item)],
    Promise.resolve([]),
  );
}
