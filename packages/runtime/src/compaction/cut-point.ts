import type { TranscriptEvent } from "@binference/store";
import {
  toolCallContentSchema,
  toolResultContentSchema,
} from "../sessions/event-content.schema.js";
import { lineOf } from "./event-text.js";
import { estimateTextTokens } from "./token-estimate.js";

/** What one stored event costs beside its text, as a message does. */
const tokensPerEvent = 4;

/** The estimated tokens of one stored event as the model reads it. */
export function estimateEventTokens(event: TranscriptEvent): number {
  const line = lineOf(event);
  return line === undefined ? 0 : tokensPerEvent + estimateTextTokens(line.text);
}

function callIdOf(event: TranscriptEvent): string | undefined {
  if (event.kind === "tool_call") {
    const parsed = toolCallContentSchema.safeParse(event.content);
    return parsed.success ? parsed.data.callId : undefined;
  }
  return undefined;
}

function resultIdOf(event: TranscriptEvent): string | undefined {
  if (event.kind === "tool_result") {
    const parsed = toolResultContentSchema.safeParse(event.content);
    return parsed.success ? parsed.data.callId : undefined;
  }
  return undefined;
}

// Where each call's result lies: a cut between a call and its result would split them.
function lastResultAt(events: readonly TranscriptEvent[]): ReadonlyMap<string, number> {
  const at = new Map<string, number>();
  for (const [index, event] of events.entries()) {
    const id = resultIdOf(event);
    if (id !== undefined) {
      at.set(id, index);
    }
  }
  return at;
}

/** Whether the history may start at each index: no call before it waits for a result after it. */
function cuttable(events: readonly TranscriptEvent[]): readonly boolean[] {
  const results = lastResultAt(events);
  const allowed: boolean[] = [];
  let openUntil = -1;
  for (let index = 0; index <= events.length; index += 1) {
    const event = events[index];
    const startsEntry =
      event === undefined ||
      (event.kind === "text" && (event.role === "owner" || event.role === "agent"));
    allowed.push(startsEntry && openUntil < index);
    const id = event === undefined ? undefined : callIdOf(event);
    const resultAt = id === undefined ? undefined : results.get(id);
    if (resultAt !== undefined && resultAt > index) {
      openUntil = Math.max(openUntil, resultAt);
    }
  }
  return allowed;
}

// An owner's message that opens a turn.
function startsTurn(events: readonly TranscriptEvent[], index: number): boolean {
  const event = events[index];
  if (event === undefined) {
    return false;
  }
  const before = events[index - 1];
  return (
    event.role === "owner" &&
    event.kind === "text" &&
    (before === undefined || before.turnId !== event.turnId)
  );
}

/**
 * Where the kept history starts (runtime spec, section 7.3): the index of the first event kept,
 * so that the kept events cost at most `keepTokens`, at a turn's start where one fits, and never
 * between a tool call and its result. The events before it are compacted. `undefined` when no
 * event would be compacted.
 */
export function cutPoint(
  events: readonly TranscriptEvent[],
  keepTokens: number,
): number | undefined {
  const allowed = cuttable(events);
  const fits: number[] = [];
  let kept = 0;
  for (let index = events.length; index >= 1; index -= 1) {
    const event = events[index];
    kept += event === undefined ? 0 : estimateEventTokens(event);
    if (kept > keepTokens) {
      break;
    }
    if (allowed[index] === true) {
      fits.push(index);
    }
  }
  const atTurn = fits.findLast((index) => startsTurn(events, index));
  return atTurn ?? fits.at(-1);
}
