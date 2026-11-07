import { displayOutsideText } from "@binference/i18n";
import { useNow } from "../app/use-now";
import { MessageLine } from "../cards/card-line";
import { useFormatter, useText } from "../i18n/console-text";
import { ChartFigure } from "./chart-figure";
import type { ChatEntry } from "./chat-entries";
import { RichText } from "./rich-text";

// A person's or the agent's text as it reads: each character a reader cannot see written out.
function shownText(text: string): string {
  return displayOutsideText(text, Number.POSITIVE_INFINITY);
}

function StatusEntry(props: {
  readonly entry: Extract<ChatEntry, { readonly kind: "status" }>;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const values = props.entry.values ?? {};
  // `{when}` is a time the engine names in epoch milliseconds; the owner reads it in their zone.
  const { when } = values;
  const shown = typeof when === "number" ? { ...values, when: formatter.dateTime(when) } : values;
  return (
    <p className="text-sm text-muted-foreground italic">
      <MessageLine text={text(props.entry.statusKey, shown)} />
    </p>
  );
}

function SaidEntry(props: {
  readonly entry: Extract<ChatEntry, { readonly kind: "owner" | "answer" }>;
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const { entry } = props;
  const isOwner = entry.kind === "owner";
  const images = entry.images ?? 0;
  return (
    <div
      className={
        isOwner
          ? "ml-auto max-w-[85%] rounded-lg bg-muted px-3 py-2 text-sm"
          : "mr-auto max-w-[85%] rounded-lg border px-3 py-2 text-sm"
      }
    >
      <span className="sr-only">
        {isOwner ? text("console.chat.fromOwner") : props.agentName}:{" "}
      </span>
      {isOwner ? (
        <p className="break-words whitespace-pre-wrap">{shownText(entry.text)}</p>
      ) : (
        <RichText text={entry.text} />
      )}
      {images === 0 ? null : (
        <p className="text-xs text-muted-foreground">
          {text("console.chat.images", { count: images })}
        </p>
      )}
    </div>
  );
}

function Entry(props: {
  readonly entry: ChatEntry;
  readonly agentName: string;
}): React.JSX.Element {
  const { entry } = props;
  if (entry.kind === "status") {
    return <StatusEntry entry={entry} />;
  }
  if (entry.kind === "chart") {
    return <ChartFigure chart={entry.chart} />;
  }
  return <SaidEntry entry={entry} agentName={props.agentName} />;
}

/**
 * The chat with one agent, oldest first: the owner's messages on the right, the agent's answers on
 * the left, and its status lines and charts between them. The agent's text shows its Markdown drawn as
 * elements, never as HTML from the text (decision 0383); the owner's shows as written. Screen
 * readers hear each new entry.
 */
export function ChatThread(props: {
  readonly entries: readonly ChatEntry[];
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const { entries, agentName } = props;
  return (
    <div
      role="log"
      aria-label={text("console.chat.log", { agent: agentName })}
      className="flex flex-col gap-3"
    >
      {entries.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text("console.chat.empty")}</p>
      ) : (
        entries.map((entry) => <Entry key={entry.id} entry={entry} agentName={agentName} />)
      )}
    </div>
  );
}

/** The agent's running turn: the answer it writes so far, else how long it has worked. */
export function WorkingLine(props: {
  readonly draft: string | undefined;
  readonly startedAt: number;
}): React.JSX.Element {
  const text = useText();
  const now = useNow();
  const { draft } = props;
  const seconds = Math.max(0, Math.floor((now - props.startedAt) / 1_000));
  return (
    <div
      aria-busy="true"
      className="mr-auto max-w-[85%] rounded-lg border border-dashed px-3 py-2 text-sm"
    >
      {draft === undefined || draft.trim() === "" ? (
        <p className="text-muted-foreground">{text("console.chat.working", { seconds })}</p>
      ) : (
        <RichText text={draft} />
      )}
    </div>
  );
}
