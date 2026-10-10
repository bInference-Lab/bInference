import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { OwnerCalls } from "../ports.js";

/** An engine with nothing frozen, the calls into it, and the owner's numeric Telegram id. */
export interface OwnerCallsSubject {
  readonly calls: OwnerCalls;
  readonly ownerId: number;
}

/** Makes a fresh subject for each check. */
export interface OwnerCallsHarness {
  create(): Promise<OwnerCallsSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });

async function isFrozen(subject: OwnerCallsSubject): Promise<boolean> {
  const request = { op: "safety/status", args: {}, senderId: subject.ownerId } as const;
  const status = await subject.calls.call(request, live());
  assert.ok(status.ok, "the owner reads the safety status");
  return status.value.frozen;
}

async function ownerReads(subject: OwnerCallsSubject): Promise<void> {
  assert.equal(await isFrozen(subject), false);
}

async function ownerBrakes(subject: OwnerCallsSubject): Promise<void> {
  const freeze = { op: "safety/freeze", args: {}, senderId: subject.ownerId } as const;
  assert.ok((await subject.calls.call(freeze, live())).ok, "the owner freezes");
  assert.equal(await isFrozen(subject), true);
}

async function strangerRunsNothing(subject: OwnerCallsSubject): Promise<void> {
  const freeze = { op: "safety/freeze", args: {}, senderId: subject.ownerId + 1 } as const;
  assert.deepEqual(await subject.calls.call(freeze, live()), { ok: false, error: "auth.scope" });
  assert.equal(await isFrozen(subject), false);
}

async function refusesAborted(subject: OwnerCallsSubject): Promise<void> {
  const reason = new Error("stopped by the caller");
  const freeze = { op: "safety/freeze", args: {}, senderId: subject.ownerId } as const;
  await assert.rejects(subject.calls.call(freeze, { signal: AbortSignal.abort(reason) }), reason);
  assert.equal(await isFrozen(subject), false);
}

/** The contract every `OwnerCalls` adapter passes. */
export function ownerCallsContract(harness: OwnerCallsHarness): readonly ContractCheck[] {
  const on =
    (run: (subject: OwnerCallsSubject) => Promise<void>): (() => Promise<void>) =>
    async () =>
      run(await harness.create());
  return [
    { name: "runs a read for the owner", run: on(ownerReads) },
    { name: "runs a brake for the owner", run: on(ownerBrakes) },
    { name: "runs nothing for anyone but the owner", run: on(strangerRunsNothing) },
    { name: "refuses a call on an aborted signal and runs nothing", run: on(refusesAborted) },
  ];
}
