import assert from "node:assert/strict";
import { type Id, idSchema, type Result } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import type { SessionDraft } from "../chats/session-record.js";
import type { WriterFence } from "../ports.js";

/** A store call nothing stops. */
export const go = (): { readonly signal: AbortSignal } => ({
  signal: new AbortController().signal,
});

/** The `n`th id of a kind, the same for the same `n`. */
export function nthId<P extends string>(prefix: P, n: number): Id<P> {
  const tail = n.toString(16).padStart(12, "0");
  return idSchema(prefix).parse(`${prefix}_0190f1c2-3a4b-7c5d-8e6f-${tail}`);
}

/** The `n`th session of the first agent, on Telegram, opened at `n` seconds. */
export function nthSession(n: number): SessionDraft {
  return {
    id: nthId("ses", n),
    agentId: nthId("agt", 1),
    surface: "telegram",
    conversation: `telegram:100:${String(n)}`,
    startedAtMs: n * 1_000,
  };
}

/** A check that raises the writer fence of a fresh subject, then runs on it with that fence. */
export function fencedCheck<Subject extends { readonly fence: WriterFence }>(
  name: string,
  create: () => Promise<Subject>,
  run: (subject: Subject, fence: number) => Promise<void>,
): ContractCheck {
  return {
    name,
    run: async () => {
      const subject = await create();
      await run(subject, await subject.fence.raise(go()));
    },
  };
}

/** Asserts that a call on an aborted signal rejects with that signal's reason. */
export async function rejectsAborted<Output>(
  call: (options: { readonly signal: AbortSignal }) => Promise<Output>,
): Promise<void> {
  const reason = new Error("the caller stopped");
  await assert.rejects(call({ signal: AbortSignal.abort(reason) }), reason);
}

/** The value of a result a check expects to succeed; a failure fails the check. */
export function okValue<T, E extends string>(result: Result<T, E>): T {
  if (!result.ok) {
    throw new assert.AssertionError({ message: `Expected a success, got ${result.error}.` });
  }
  return result.value;
}
