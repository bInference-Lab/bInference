import { displayOutsideText } from "@binference/i18n";
import { useText } from "../i18n/console-text";
import type { ChatEntry } from "./chat-entries";

// A person's or the agent's text as it reads: each character a reader cannot see written out.
function shownText(text: string): string {
  return displayOutsideText(text, Number.POSITIVE_INFINITY);
}

function SaidEntry(props: {
  readonly entry: ChatEntry;
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const { entry } = props;
  const isOwner = entry.kind === "owner";
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
      <p className="break-words whitespace-pre-wrap">{shownText(entry.text)}</p>
    </div>
  );
}

/**
 * The chat with one agent, oldest first: the owner's messages on the right and the agent's answers
 * on the left. Model text shows as text, never as markup. Screen readers hear each new entry.
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
        entries.map((entry) => <SaidEntry key={entry.id} entry={entry} agentName={agentName} />)
      )}
    </div>
  );
}
