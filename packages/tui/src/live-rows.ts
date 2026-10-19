import { cardLineText, type Formatter } from "@binference/i18n";
import type { Words } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import { type ChatState, type OpenCard, secondsLeft } from "./chat-state.js";
import { tailWidth } from "./fit-width.js";

/** What the live area is drawn with besides the state. */
export interface LiveContext {
  readonly formatter: Formatter;
  readonly words: Words;
  readonly agentName: string;
  readonly now: number;
  /** The terminal's width: the line the owner types, and the answer so far, show their ends. */
  readonly columns: number;
}

// The columns the prompt mark and its space take, and the one a row leaves free.
const promptMark = "› ";
const markColumns = 3;

function runningRow(state: ChatState, context: LiveContext): readonly ScreenLine[] {
  const { running } = state;
  if (running === undefined) {
    return [];
  }
  const draft = running.draft?.trim().split(/\r?\n/).at(-1);
  if (draft !== undefined && draft !== "") {
    const speaker = `${context.agentName}: `;
    const room = Math.max(1, context.columns - speaker.length - 1);
    return [{ text: `${speaker}${tailWidth(draft, room)}`, tone: "dim" }];
  }
  const seconds = Math.max(0, Math.floor((context.now - running.startedAt) / 1_000));
  return [{ text: context.words("tui.working", { seconds }), tone: "dim" }];
}

function questionRow(state: ChatState, words: Words): readonly ScreenLine[] {
  const { question } = state;
  return question === undefined
    ? []
    : [{ text: words("tui.question.keys", { last: question.choices.length }) }];
}

function cardRows(cards: readonly OpenCard[], context: LiveContext): readonly ScreenLine[] {
  const [first, ...rest] = cards;
  if (first === undefined) {
    return [];
  }
  const { formatter, words } = context;
  const [header] = first.shown.lines;
  const title =
    header === undefined ? "" : cardLineText(header, { formatter, assets: first.shown.assets });
  const seconds = secondsLeft(first, context.now);
  const keys = seconds === 0 ? words("tui.card.expired") : words("tui.card.keys", { seconds });
  const more = rest.length === 0 ? [] : [{ text: words("tui.card.more", { count: rest.length }) }];
  return [{ text: `${title} · ${keys}`, tone: "yellow" }, ...more];
}

// The line the owner types, its newest characters kept; a new line of a paste shows as ↵.
function promptRow(state: ChatState, columns: number): ScreenLine {
  const typed = state.input.replaceAll("\n", " ↵ ");
  return { text: `${promptMark}${tailWidth(typed, Math.max(1, columns - markColumns))}` };
}

/**
 * The live area's rows, top to bottom: the link while it reconnects, the agent's running turn
 * (the newest line of its answer so far, else how long it has worked), the open question's keys,
 * the first waiting card with its time left and its keys, and the line the owner types.
 */
export function liveRows(state: ChatState, context: LiveContext): readonly ScreenLine[] {
  const link = state.isReconnecting
    ? [{ text: context.words("tui.reconnecting"), tone: "dim" as const }]
    : [];
  return [
    ...link,
    ...runningRow(state, context),
    ...questionRow(state, context.words),
    ...cardRows(state.cards, context),
    promptRow(state, context.columns),
  ];
}
