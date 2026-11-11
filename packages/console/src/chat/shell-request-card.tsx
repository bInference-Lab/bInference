import { displayOutsideText } from "@binference/i18n";
import type { ProtocolId, ShellAnswer, ShellRequestView } from "@binference/protocol";
import { Button } from "../components/ui/button";
import { errorWords } from "../connection/error-words";
import { useFormatter, useText } from "../i18n/console-text";
import { useShellRequest } from "./use-shell-request";

// The command a request shows: every character a reader cannot see written out.
const commandCharacters = 3_000;

function RequestLines(props: {
  readonly view: ShellRequestView;
  readonly agentName: string;
}): React.JSX.Element {
  const text = useText();
  const formatter = useFormatter();
  const { view } = props;
  return (
    <>
      <p className="font-medium">{text("shell.request.header", { agent: props.agentName })}</p>
      <pre className="overflow-x-auto rounded-md bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap break-words">
        {displayOutsideText(view.command, commandCharacters)}
      </pre>
      <p className="break-words">{text("shell.request.folder", { folder: view.folder })}</p>
      <p>{text("shell.request.reason", { reason: view.reason })}</p>
      {view.canAlwaysAllow ? null : (
        <p className="text-xs text-muted-foreground">{text("shell.request.noAlways")}</p>
      )}
      <p className="text-xs text-muted-foreground">
        {text("shell.request.until", { time: formatter.time(view.closesAt) })}
      </p>
    </>
  );
}

function AnswerButtons(props: {
  readonly view: ShellRequestView;
  readonly disabled: boolean;
  readonly onAnswer: (answer: ShellAnswer) => void;
}): React.JSX.Element {
  const text = useText();
  const { disabled, onAnswer } = props;
  return (
    <div className="flex flex-wrap gap-2">
      <Button size="sm" disabled={disabled} onClick={() => onAnswer("once")}>
        {text("shell.request.once")}
      </Button>
      {props.view.canAlwaysAllow ? (
        <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer("always")}>
          {text("shell.request.always")}
        </Button>
      ) : null}
      <Button size="sm" variant="outline" disabled={disabled} onClick={() => onAnswer("refuse")}>
        {text("shell.request.refuse")}
      </Button>
    </div>
  );
}

/**
 * The agent's shell request (decision 0409), above the composer: who asks, the command, its
 * folder, why it asks and until when, with Allow once, Always allow where it is offered, and
 * Refuse. The first answer from any surface wins; a closed request leaves the card.
 */
export function ShellRequestCard(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
  readonly canAnswer: boolean;
}): React.JSX.Element | null {
  const text = useText();
  const { open, answer } = useShellRequest(props.agent);
  if (open === undefined) {
    return null;
  }
  return (
    <section
      aria-label={text("console.shell.label")}
      className="flex flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <RequestLines view={open} agentName={props.agentName} />
      <AnswerButtons
        view={open}
        disabled={!props.canAnswer || answer.isPending}
        onAnswer={(chosen) => answer.mutate({ request: open, answer: chosen })}
      />
      {answer.error === null ? null : (
        <p role="alert" className="text-xs text-destructive">
          {errorWords(text, answer.error)}
        </p>
      )}
    </section>
  );
}
