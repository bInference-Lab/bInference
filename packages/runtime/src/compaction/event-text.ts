import type { TranscriptEvent } from "@binference/store";
import {
  agentTextContentSchema,
  ownerTextContentSchema,
  toolCallContentSchema,
  summaryContentSchema,
  toolResultContentSchema,
} from "../sessions/event-content.schema.js";

/** One transcript event as the summary model and the identifier check read it. */
export interface EventLine {
  /** Who wrote it, as the summary model reads it. */
  readonly label: string;
  readonly text: string;
}

function ownerLine(event: TranscriptEvent): EventLine | undefined {
  const parsed = ownerTextContentSchema.safeParse(event.content);
  return parsed.success ? { label: "owner", text: parsed.data.text } : undefined;
}

function agentLine(event: TranscriptEvent): EventLine | undefined {
  const parsed = agentTextContentSchema.safeParse(event.content);
  if (!parsed.success) {
    return undefined;
  }
  const { text, reasoning } = parsed.data;
  const said = [reasoning === "" ? "" : `(thinking) ${reasoning}`, text].filter(
    (part) => part !== "",
  );
  return { label: "agent", text: said.join("\n") };
}

function callLine(event: TranscriptEvent): EventLine | undefined {
  const parsed = toolCallContentSchema.safeParse(event.content);
  return parsed.success
    ? { label: `agent calls ${parsed.data.name}`, text: parsed.data.arguments }
    : undefined;
}

function resultLine(event: TranscriptEvent): EventLine | undefined {
  const parsed = toolResultContentSchema.safeParse(event.content);
  return parsed.success
    ? { label: `result of ${parsed.data.name}`, text: parsed.data.text }
    : undefined;
}

function summaryLine(event: TranscriptEvent): EventLine | undefined {
  const parsed = summaryContentSchema.safeParse(event.content);
  return parsed.success ? { label: "earlier summary", text: parsed.data.text } : undefined;
}

// How each kind of event reads; an image is not read as text.
const readers: Readonly<
  Record<TranscriptEvent["kind"], (event: TranscriptEvent) => EventLine | undefined>
> = {
  text: (event) => (event.role === "owner" ? ownerLine(event) : agentLine(event)),
  tool_call: callLine,
  tool_result: resultLine,
  summary: summaryLine,
  image: () => undefined,
};

/** What an event says, or `undefined` for an event the model does not read. */
export function lineOf(event: TranscriptEvent): EventLine | undefined {
  return readers[event.kind](event);
}

/** The texts of events, each event's own text alone. */
export function textsOf(events: readonly TranscriptEvent[]): readonly string[] {
  return events.flatMap((event) => {
    const line = lineOf(event);
    return line === undefined ? [] : [line.text];
  });
}
