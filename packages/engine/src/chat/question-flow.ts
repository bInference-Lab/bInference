import { err, type JsonValue, jsonValueSchema, ok, type Result } from "@binference/core";
import {
  type ChatSurface,
  type ProtocolErrorCode,
  type QuestionView,
  questionViewSchema,
} from "@binference/protocol";
import { activeAgent } from "../operations/active-agent.js";
import type { EngineCall } from "../operations/engine-call.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import { type ChatRelayOptions, chatTopic, pushInbox } from "./chat-relay-parts.js";
import { isAnswerable, questionOpenMs, type QuestionRecord } from "./question-record.js";

/** How many random bytes a question's button reference holds. */
const refBytes = 12;

/** A question as `turn/ask` answers it and `chat/question` carries it. */
function questionViewOf(question: QuestionRecord): QuestionView {
  const { answer, closeReason } = question;
  return {
    question: question.id,
    agent: question.agentId,
    session: question.sessionId,
    turn: question.turnId,
    text: question.text,
    choices: [...question.choices],
    state: question.state,
    ...(answer === undefined
      ? {}
      : {
          answer: {
            ...(answer.choice === undefined ? {} : { choice: answer.choice }),
            ...(answer.typed === undefined ? {} : { typed: answer.typed }),
            surface: answer.surface,
            at: answer.atMs,
          },
        }),
    ...(closeReason === undefined ? {} : { closeReason }),
    createdAt: question.createdAtMs,
    closesAt: question.closesAtMs,
  };
}

// A view as JSON, for a push.
function questionPushData(view: QuestionView): JsonValue {
  return jsonValueSchema.parse(questionViewSchema.encode(view));
}

// Every surface hears that a question closed: its copies lose their buttons and show the end.
function pushClosed(options: ChatRelayOptions, question: QuestionRecord): void {
  const view = questionViewOf(question);
  const { answer, closeReason } = view;
  options.publish({
    topic: chatTopic(question.agentId),
    kind: "chat/questionClosed",
    data: {
      agent: question.agentId,
      question: question.id,
      state: question.state,
      ...(answer === undefined ? {} : { answer: { ...answer } }),
      ...(closeReason === undefined ? {} : { closeReason }),
    },
  });
}

/**
 * Closes a question that is still open with a reason, as a clear or its expiry does, and tells
 * every surface. Nothing happens to one that closed already.
 */
export async function closeQuestion(
  options: ChatRelayOptions,
  question: QuestionRecord,
  call: { readonly reason: "cleared" | "expired"; readonly signal: AbortSignal },
): Promise<void> {
  const closing = { questionId: question.id, reason: call.reason, atMs: options.clock.now() };
  const closed = await options.questions.close(closing, call);
  if (closed !== undefined) {
    pushClosed(options, closed);
  }
}

/**
 * `turn/ask`: stores the agent's question in its running turn and draws it on every chat surface;
 * the agent's open question closes first, `replaced`, or `expired` once 24 hours old. A turn that is
 * not the agent's running one is `protocol.bad_args`.
 */
export async function askOwner(
  options: ChatRelayOptions,
  call: EngineCall<"turn/ask">,
): Promise<Result<QuestionView, ProtocolErrorCode>> {
  const { agent, session, turn, text, choices } = call.args;
  if (options.turns.runningOf(agent)?.turn !== turn) {
    return err("protocol.bad_args");
  }
  const active = await activeAgent(options.agents, agent, call);
  if (!active.ok) {
    return active;
  }
  const now = options.clock.now();
  const ref = Buffer.from(options.random.bytes(refBytes)).toString("base64url");
  const record: QuestionRecord = {
    id: options.ids.next("qst"),
    agentId: agent,
    sessionId: session,
    turnId: turn,
    text,
    choices: [...choices],
    ref,
    state: "open",
    createdAtMs: now,
    closesAtMs: now + questionOpenMs,
  };
  const { asked, closed } = await options.questions.ask(record, call);
  if (closed !== undefined) {
    pushClosed(options, closed);
  }
  const view = questionViewOf(asked);
  options.publish({ topic: chatTopic(agent), kind: "chat/question", data: questionPushData(view) });
  return ok(view);
}

/** The owner's answer to a question: a choice by its place, or a message written instead. */
export type OwnerAnswer =
  | { readonly choice: number; readonly surface: ChatSurface }
  | {
      readonly typed: string;
      readonly images?: readonly string[];
      readonly surface: ChatSurface;
    };

function payloadOf(question: QuestionRecord, answer: OwnerAnswer) {
  if ("choice" in answer) {
    const text = question.choices[answer.choice] ?? "";
    const { surface, choice } = answer;
    return { text, surface, answer: { question: question.id, choice } };
  }
  const { typed, images, surface } = answer;
  return { text: typed, ...(images === undefined ? {} : { images: [...images] }), surface };
}

/**
 * Answers an open question and stores the answer's `inbox/message` in one write, then tells every
 * surface and pushes the message to the runtime, which so gets it once. A question that has
 * expired closes now and is `question.closed`, as is one answered or closed before; a choice the
 * question lacks is `protocol.bad_args`.
 */
export async function answerQuestion(
  options: ChatRelayOptions,
  question: QuestionRecord,
  call: { readonly answer: OwnerAnswer; readonly signal: AbortSignal },
): Promise<Result<AgentInboxMessage, ProtocolErrorCode>> {
  const { answer, signal } = call;
  const now = options.clock.now();
  if (!isAnswerable(question, now)) {
    if (question.state === "open") {
      await closeQuestion(options, question, { reason: "expired", signal });
    }
    return err("question.closed");
  }
  if ("choice" in answer && question.choices[answer.choice] === undefined) {
    return err("protocol.bad_args");
  }
  const { ids } = options;
  const answered = await options.questions.answer(
    {
      questionId: question.id,
      answer:
        "choice" in answer
          ? { choice: answer.choice, surface: answer.surface, atMs: now }
          : { typed: answer.typed, surface: answer.surface, atMs: now },
      message: {
        id: ids.next("msg"),
        turnId: ids.next("trn"),
        opens: ids.next("ses"),
        payload: payloadOf(question, answer),
      },
    },
    { signal },
  );
  if (!answered.ok) {
    const codes = {
      closed: "question.closed",
      not_found: "question.not_found",
      busy: "protocol.busy",
    } as const;
    return err(codes[answered.error]);
  }
  pushClosed(options, answered.value.question);
  await pushInbox(options, answered.value.message, signal);
  return ok(answered.value.message);
}
