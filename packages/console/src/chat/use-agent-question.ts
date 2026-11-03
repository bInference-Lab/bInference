import {
  type ProtocolId,
  type ResultOf,
  type QuestionClosedPush,
  type QuestionView,
  questionPushOf,
} from "@binference/protocol";
import {
  useMutation,
  type UseMutationResult,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { useRef, useState } from "react";
import { useEngine } from "../connection/engine-context";
import { useTopic } from "../connection/use-topic";

/** A question that closed while the page showed it, and how it ended. */
export interface EndedQuestion {
  readonly view: QuestionView;
  readonly closed: QuestionClosedPush;
}

/** The owner's press: the open question and the place of the choice pressed. */
interface Press {
  readonly question: QuestionView;
  readonly place: number;
}

/** The answer to the open question by a button, through `chat/answer`. */
type AnswerAction = UseMutationResult<ResultOf<"chat/answer">, Error, Press>;

/** The agent's question as the chat shows it, and the answer the owner gives it by a button. */
export interface AgentQuestion {
  /** The open question; none while the agent has none or it is still loading. */
  readonly open?: QuestionView;
  /** The last question this page showed, once it closed, until the next question. */
  readonly ended?: EndedQuestion;
  /** The answer by a button: whether it is on its way, and why the engine refused it. */
  readonly answer: AnswerAction;
  /**
   * Answers the question with the choice at `place`, once: a later press on the same question
   * sends nothing, unless the first failed for a reason other than the question having closed.
   */
  readonly press: (question: QuestionView, place: number) => void;
}

function questionKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["question", agent];
}

/** Whether the engine refused an answer because the question had closed. */
export function isClosedRefusal(error: Error | null): boolean {
  return error !== null && "code" in error && error.code === "question.closed";
}

// The answer by a button, sent once per question: the mutation's state changes only after the
// next render, so a second press before it finds the question already pressed.
function useAnswer(agent: ProtocolId<"agent">): Pick<AgentQuestion, "answer" | "press"> {
  const { client } = useEngine();
  const pressed = useRef<string | undefined>(undefined);
  const answer = useMutation({
    mutationFn: async (press: Press) =>
      client.call(
        "chat/answer",
        { agent, question: press.question.question, choice: press.place },
        { signal: AbortSignal.timeout(60_000) },
      ),
    onError: (error) => {
      if (!isClosedRefusal(error)) {
        pressed.current = undefined;
      }
    },
  });
  const press = (question: QuestionView, place: number): void => {
    if (pressed.current === question.question) {
      return;
    }
    pressed.current = question.question;
    answer.mutate({ question, place });
  };
  return { answer, press };
}

/**
 * The agent's open question (decision 0248): read with `chat/openQuestion` when the chat opens,
 * again at each question push and after a gap in the agent's chat topic. A question that closes
 * while shown stays, with how it ended, until the next one.
 */
export function useAgentQuestion(agent: ProtocolId<"agent">): AgentQuestion {
  const { client } = useEngine();
  const queries = useQueryClient();
  const key = questionKey(agent);
  const [ended, setEnded] = useState<EndedQuestion | undefined>(undefined);
  const open = useQuery({
    queryKey: key,
    queryFn: async ({ signal }) =>
      (await client.call("chat/openQuestion", { agent }, { signal })).question ?? null,
    retry: false,
  });
  const { answer, press } = useAnswer(agent);
  const reload = async (): Promise<void> => queries.invalidateQueries({ queryKey: key });
  useTopic(`chat:${agent}`, {
    onPush: (frame) => {
      const push = questionPushOf(frame);
      if (push === undefined) {
        return;
      }
      const shown = queries.getQueryData<QuestionView | null>(key);
      setEnded(
        push.kind === "chat/questionClosed" && shown?.question === push.question
          ? { view: shown, closed: push }
          : undefined,
      );
      void reload();
    },
    refetch: reload,
  });
  const shown = open.data ?? undefined;
  return {
    ...(shown === undefined ? {} : { open: shown }),
    ...(ended === undefined ? {} : { ended }),
    answer,
    press,
  };
}
