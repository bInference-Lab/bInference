import assert from "node:assert/strict";
import type { ContractCheck } from "@binference/core/testing";
import type { RelaySender } from "../sending/ports.js";
import { type RelayAnswer, type RelayRefusal, relayRefusals } from "../sending/relay-answer.js";
import type { SignedTx } from "../transaction.js";

/** How one relay of a subject answers: as a relay that takes, refuses, hangs or cannot be reached. */
export type RelayBehavior =
  | { readonly kind: "accept" }
  | { readonly kind: "refuse"; readonly reason: RelayRefusal }
  | { readonly kind: "hang" }
  | { readonly kind: "unreachable" };

/** Bytes one relay received. */
export interface RelayDelivery {
  readonly relay: string;
  readonly raw: string;
}

/** A relay sender under test, over one relay per behavior, and a signed transaction it sends. */
export interface RelaySenderSubject {
  readonly sender: RelaySender;
  readonly signed: SignedTx;
  /** What the relays received so far, in the order it arrived. */
  readonly received: () => readonly RelayDelivery[];
}

/**
 * Makes a fresh {@link RelaySenderSubject} for each check: one relay per behavior, in that order.
 * A hanging relay's wait ends within a second.
 */
export interface RelaySenderHarness {
  create(behaviors: readonly RelayBehavior[]): Promise<RelaySenderSubject>;
}

const live = (): { readonly signal: AbortSignal } => ({ signal: new AbortController().signal });
const accept: RelayBehavior = { kind: "accept" };

function outcomes(answers: readonly RelayAnswer[]): readonly string[] {
  return answers.map((answer) =>
    answer.outcome === "refused" ? `refused:${answer.reason}` : answer.outcome,
  );
}

function byRelay(left: Readonly<RelayDelivery>, right: Readonly<RelayDelivery>): number {
  return left.relay.localeCompare(right.relay);
}

async function answersInOrder(harness: RelaySenderHarness): Promise<void> {
  const { sender, signed, received } = await harness.create([accept, accept]);
  const answers = await sender.send(signed, live());
  assert.equal(sender.relays.length, 2);
  assert.deepEqual(
    answers.map((answer) => answer.relay),
    sender.relays,
  );
  assert.deepEqual(outcomes(answers), ["accepted", "accepted"]);
  const delivered = received().toSorted(byRelay);
  const expected = sender.relays.map((relay) => ({ relay, raw: signed.raw })).toSorted(byRelay);
  assert.deepEqual(delivered, expected);
}

async function namesRefusals(harness: RelaySenderHarness): Promise<void> {
  const refusing = relayRefusals.map((reason): RelayBehavior => ({ kind: "refuse", reason }));
  const { sender, signed } = await harness.create([...refusing, accept]);
  const answers = await sender.send(signed, live());
  assert.deepEqual(outcomes(answers), [
    ...relayRefusals.map((reason) => `refused:${reason}`),
    "accepted",
  ]);
}

async function timeoutDelaysNoOne(harness: RelaySenderHarness): Promise<void> {
  const { sender, signed, received } = await harness.create([{ kind: "hang" }, accept]);
  const answers = await sender.send(signed, live());
  assert.deepEqual(outcomes(answers), ["timed_out", "accepted"]);
  const [hung, took] = answers;
  assert.ok(hung !== undefined && took !== undefined);
  assert.ok(took.atMs <= hung.atMs, "the accepting relay answered before the other's wait ended");
  assert.ok(received().some((delivery) => delivery.relay === took.relay));
}

async function namesUnreachable(harness: RelaySenderHarness): Promise<void> {
  const { sender, signed } = await harness.create([{ kind: "unreachable" }, accept]);
  assert.deepEqual(outcomes(await sender.send(signed, live())), ["unreachable", "accepted"]);
}

async function sendsNothingAborted(harness: RelaySenderHarness): Promise<void> {
  const { sender, signed, received } = await harness.create([accept]);
  const reason = new Error("stopped");
  await assert.rejects(sender.send(signed, { signal: AbortSignal.abort(reason) }), reason);
  assert.deepEqual(received(), []);
}

/** The contract every `RelaySender` adapter passes. */
export function relaySenderContract(harness: RelaySenderHarness): readonly ContractCheck[] {
  return [
    {
      name: "sends the same bytes to every relay and answers each, in the order of its relays",
      run: async () => answersInOrder(harness),
    },
    { name: "names each refusal's reason", run: async () => namesRefusals(harness) },
    {
      name: "answers a relay that times out without delaying another relay's send",
      run: async () => timeoutDelaysNoOne(harness),
    },
    {
      name: "answers a relay it cannot reach as unreachable",
      run: async () => namesUnreachable(harness),
    },
    {
      name: "rejects with the signal's reason once the signal aborts, and sends nothing",
      run: async () => sendsNothingAborted(harness),
    },
  ];
}
