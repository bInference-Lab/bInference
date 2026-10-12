import type { TranscriptEvent } from "@binference/store";
import { nthTestId } from "./memory-agent-stores.js";

/** One event of a test transcript, as a turn wrote it. */
export type TestEvent =
  | { readonly owner: string; readonly outside?: boolean }
  | { readonly agent: string }
  | { readonly call: string; readonly name?: string; readonly args?: string }
  | { readonly result: string; readonly text: string; readonly outside?: boolean }
  | {
      readonly summary: string;
      readonly fromSeq: number;
      readonly throughSeq: number;
      readonly outside?: boolean;
    };

function draftOf(
  event: TestEvent,
  seq: number,
): Pick<TranscriptEvent, "role" | "kind" | "content" | "outside"> {
  if ("owner" in event) {
    const content = { message: `msg_${String(seq)}`, text: event.owner };
    return { role: "owner", kind: "text", content, outside: event.outside === true };
  }
  if ("agent" in event) {
    return {
      role: "agent",
      kind: "text",
      content: { text: event.agent, reasoning: "" },
      outside: false,
    };
  }
  if ("call" in event) {
    const content = {
      callId: event.call,
      name: event.name ?? "quote",
      arguments: event.args ?? "{}",
    };
    return { role: "agent", kind: "tool_call", content, outside: false };
  }
  if ("result" in event) {
    const content = {
      callId: event.result,
      name: "quote",
      text: event.text,
      isError: false,
      ran: true,
    };
    return { role: "tool", kind: "tool_result", content, outside: event.outside === true };
  }
  const { summary: text, fromSeq, throughSeq } = event;
  return {
    role: "system",
    kind: "summary",
    content: { text, fromSeq, throughSeq },
    outside: event.outside === true,
  };
}

/**
 * A session's transcript from turns of test events, each turn under its own id, never the test
 * turn's, and the events numbered from `firstSeq`, 1 when absent, one after another.
 */
export function transcriptOf(
  turns: readonly (readonly TestEvent[])[],
  firstSeq = 1,
): readonly TranscriptEvent[] {
  const sessionId = nthTestId("ses", 1);
  const flat = turns.flatMap((events, turn) => events.map((event) => ({ event, turn })));
  return flat.map(({ event, turn }, index): TranscriptEvent => {
    const seq = firstSeq + index;
    const { role, kind, content, outside } = draftOf(event, seq);
    const turnId = nthTestId("trn", turn + 2);
    return { id: seq, sessionId, turnId, seq, role, kind, content, outside, atMs: 1_000 + index };
  });
}
