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
import { useState } from "react";
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
  /** Answers the open question with the choice at `place`. */
  readonly answer: AnswerAction;
}

function questionKey(agent: ProtocolId<"agent">): readonly string[] {
  return ["question", agent];
}

function useAnswer(agent: ProtocolId<"agent">): AnswerAction {
  const { client } = useEngine();
  return useMutation({
    mutationFn: async (answer: Press) =>
      client.call(
        "chat/answer",
        { agent, question: answer.question.question, choice: answer.place },
        { signal: AbortSignal.timeout(60_000) },
      ),
  });
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
  const answer = useAnswer(agent);
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
  };
}
