import type { EngineView } from "../contracts/turn-engine-contract.js";
import type { JournalEntry, JournalView } from "../contracts/turn-journal-contract.js";
import { statusKeysOf } from "../relay/status-keys.js";
import type { RecordedStep } from "./turn-recorder.js";

function entryOf(step: RecordedStep): readonly JournalEntry[] {
  if (step.kind === "response") {
    return [{ kind: "response", text: step.text }];
  }
  if (step.kind === "call") {
    return [{ kind: "call", id: step.id }];
  }
  if (step.kind === "proposal") {
    return [{ kind: "proposal", id: step.id, key: step.key }];
  }
  if (step.kind === "result") {
    return [{ kind: "result", id: step.id, ran: step.ran, outside: step.outside }];
  }
  return step.kind === "joined" ? [{ kind: "joined", ids: step.ids }] : [];
}

/** What a recorder's journal holds, as the journal contract reads a journal back. */
export function recordedJournal(steps: readonly RecordedStep[]): JournalView {
  const end = steps.find((step) => step.kind === "journalEnd");
  return {
    entries: steps.flatMap(entryOf),
    committed: steps.some((step) => step.kind === "proposal"),
    outside: steps.some((step) => step.kind === "journalMark"),
    ...(end === undefined ? {} : { end: { outcome: end.outcome, heldBack: end.heldBack } }),
  };
}

/** What a recorder's engine holds of its turn, as the engine contract reads an engine back. */
export function recordedEngine(
  steps: readonly RecordedStep[],
  options: { readonly refused: boolean },
): EngineView {
  const start = steps.find((step) => step.kind === "start");
  const end = steps.find((step) => step.kind === "end");
  const started = start === undefined || options.refused ? undefined : start;
  return {
    ...(started === undefined
      ? {}
      : { started: { messages: started.messages, outside: started.outside } }),
    running: started !== undefined && end === undefined,
    marked: started?.outside === true || steps.some((step) => step.kind === "engineMark"),
    said: steps.flatMap((step) => (step.kind === "say" ? [step.text] : [])),
    statusKeys: steps.flatMap((step) =>
      step.kind === "status" ? statusKeysOf(step.line).map(({ key }) => key) : [],
    ),
    ...(end === undefined ? {} : { ended: end.outcome }),
  };
}
