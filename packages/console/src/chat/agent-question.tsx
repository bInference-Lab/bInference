import { displayOutsideText } from "@binference/i18n";
import type { ProtocolId, QuestionView } from "@binference/protocol";
import { Button } from "../components/ui/button";
import { errorWords } from "../connection/error-words";
import { useText, type Words } from "../i18n/console-text";
import { type EndedQuestion, useAgentQuestion } from "./use-agent-question";

// The most of the agent's words a question shows, and of each choice (spec 4, section 8.2).
const mostText = 500;
const mostChoice = 64;

function isClosedRefusal(error: Error | null): boolean {
  return error !== null && "code" in error && error.code === "question.closed";
}

// The last line of a question that closed: the choice pressed, an answer written in the chat, or
// why it closed unanswered.
function endedLine(text: Words, ended: EndedQuestion, agentName: string): string {
  const { view, closed } = ended;
  const choice = closed.answer?.choice;
  if (choice !== undefined) {
    const label = displayOutsideText(view.choices[choice] ?? "", mostChoice);
    return text("question.answered", { choice: label });
  }
  if (closed.state === "answered") {
    return text("question.answeredTyped");
  }
  return text("question.closed", { reason: closed.closeReason ?? "expired", agent: agentName });
}

function QuestionFrame(props: {
  readonly view: QuestionView;
  readonly agentName: string;
  readonly children: React.ReactNode;
}): React.JSX.Element {
  const text = useText();
  const header = text("question.header", { agent: props.agentName });
  return (
    <section
      aria-label={header}
      className="mr-auto flex max-w-[85%] flex-col gap-2 rounded-lg border px-3 py-2 text-sm"
    >
      <p className="font-medium">{header}</p>
      <p className="break-words whitespace-pre-wrap">
        {displayOutsideText(props.view.text, mostText)}
      </p>
      {props.children}
    </section>
  );
}

/**
 * The agent's question below the chat (decision 0248): its words and one plain button per choice,
 * which answers it with `chat/answer`, and the hint that a written message answers it too. Once
 * it closes, the buttons go and the last line says how it ended. Only a connection with `chat`
 * answers; the agent's words show as text, every character a reader cannot see written out.
 */
export function AgentQuestionCard(props: {
  readonly agent: ProtocolId<"agent">;
  readonly agentName: string;
  readonly canAnswer: boolean;
}): React.JSX.Element | null {
  const text = useText();
  const { agentName } = props;
  const { open, ended, answer } = useAgentQuestion(props.agent);
  if (open === undefined) {
    return ended === undefined ? null : (
      <QuestionFrame view={ended.view} agentName={agentName}>
        <p className="text-muted-foreground">{endedLine(text, ended, agentName)}</p>
      </QuestionFrame>
    );
  }
  const { error } = answer;
  return (
    <QuestionFrame view={open} agentName={agentName}>
      <div className="flex flex-wrap gap-2">
        {open.choices.map((choice, place) => (
          <Button
            key={choice}
            type="button"
            variant="secondary"
            size="sm"
            disabled={!props.canAnswer || answer.isPending}
            onClick={() => answer.mutate({ question: open, place })}
          >
            {displayOutsideText(choice, mostChoice)}
          </Button>
        ))}
      </div>
      <p className="text-muted-foreground">{text("question.typeHint")}</p>
      {error === null ? null : (
        <output className="text-destructive">
          {isClosedRefusal(error) ? text("question.closedToast") : errorWords(text, error)}
        </output>
      )}
    </QuestionFrame>
  );
}
