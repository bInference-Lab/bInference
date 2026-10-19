import { displayOutsideText } from "@binference/i18n";
import { type QuestionClosedPush, questionLimits, type QuestionView } from "@binference/protocol";
import { callOptions, type ChatContext } from "./chat-context.js";
import { failureText, questionLines, type Words } from "./chat-lines.js";
import type { ScreenLine } from "./chat-screen.js";
import { withoutQuestion } from "./chat-state.js";

/** The agent's open question in the chat: shown once it opens, answered by a number key. */
export interface AgentQuestion {
  /** Reads the open question with `chat/openQuestion`, and prints it when it is new. */
  reload(): Promise<void>;
  /** Prints how the shown question ended, and takes it off the live area. */
  closed(push: QuestionClosedPush): void;
  /** Answers the open question with the choice at `place`, through `chat/answer`. */
  answer(place: number): Promise<void>;
}

// The line that says how a question ended: the choice pressed, a message written, or why it closed
// with no answer.
function endedLine(words: Words, ended: EndedQuestion, agentName: string): ScreenLine {
  const { view, closed } = ended;
  const choice = closed.answer?.choice;
  if (choice !== undefined) {
    const label = displayOutsideText(view.choices[choice] ?? "", questionLimits.choice);
    return { text: words("question.answered", { choice: label }), tone: "dim" };
  }
  if (closed.state === "answered") {
    return { text: words("question.answeredTyped"), tone: "dim" };
  }
  const reason = closed.closeReason ?? "expired";
  return { text: words("question.closed", { reason, agent: agentName }), tone: "dim" };
}

interface EndedQuestion {
  readonly view: QuestionView;
  readonly closed: QuestionClosedPush;
}

function isClosedRefusal(error: ErrorOptions["cause"]): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "question.closed"
  );
}

/**
 * The agent's question (decision 0248): read when the chat opens, at each question push and after
 * a gap in the agent's chat topic. A new question prints its words and numbered choices; the live
 * area shows its keys until it closes, and the line that says how it closed prints then.
 */
export function createAgentQuestion(context: ChatContext): AgentQuestion {
  const { client, agent, formatter, words, store, print } = context;
  return {
    reload: async () => {
      const { question } = await client.call("chat/openQuestion", { agent }, callOptions(context));
      const shown = store.get().question;
      if (question?.question === shown?.question) {
        return;
      }
      if (question !== undefined) {
        print(questionLines(formatter, question, context.agentName));
      }
      store.update((state) =>
        question === undefined ? withoutQuestion(state) : { ...state, question },
      );
    },
    closed: (push) => {
      const view = store.get().question;
      if (view?.question !== push.question) {
        return;
      }
      print([endedLine(words, { view, closed: push }, context.agentName)]);
      store.update(withoutQuestion);
    },
    answer: async (place) => {
      const view = store.get().question;
      if (view === undefined) {
        return;
      }
      const args = { agent, question: view.question, choice: place };
      try {
        await client.call("chat/answer", args, callOptions(context));
      } catch (error) {
        const text = isClosedRefusal(error)
          ? words("question.closedToast")
          : failureText(words, error);
        print([{ text, tone: "dim" }]);
      }
    },
  };
}
