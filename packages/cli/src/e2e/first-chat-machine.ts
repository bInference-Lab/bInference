import { createManualClock, createMemoryWorkspaceFiles } from "@binference/core/testing";
import { createRunningTurns } from "@binference/engine/chat";
import { makeAgentWorkspace } from "@binference/engine/install";
import { testAgent } from "@binference/engine/testing";
import type { Locale } from "@binference/protocol";
import {
  callsReply,
  createSharedScript,
  type ModelRequest,
  type SharedScript,
  textReply,
} from "@binference/runtime/testing";
import { createMemoryAgentDatabase } from "@binference/store/testing";
import { z } from "zod";
import { type Skeleton, skeletonCompositions, startSkeleton } from "../compose/test-skeleton.js";
import { type ChatWatch, superviseRuntime, watchChat } from "./runtime-machine.js";

// The first chat end to end: the engine makes the agent's workspace files in the owner's language,
// the owner writes, the agent runtime the engine starts (in this process, on a scripted model)
// asks the questions of FIRST-CHAT.md, writes STRATEGY.md and PERSONA.md with its own tool, and
// ends the first chat, which removes FIRST-CHAT.md and ends the turn with its status line.

const live = (): { readonly signal: AbortSignal } => ({ signal: AbortSignal.timeout(10_000) });

/** One language's first chat: the owner's answers, and the files the agent writes from them. */
export interface Interview {
  readonly locale: Locale;
  readonly answers: readonly string[];
  readonly strategy: string;
  readonly persona: string;
}

/** The engine with its agent's workspace, the agent runtime it started, and its chat topic. */
export interface FirstChat {
  readonly skeleton: Skeleton;
  readonly chat: ChatWatch;
  /**
   * Stops the runtime and starts it again on the same agent database, after `between` ran while
   * it was down.
   */
  restart(between?: () => Promise<void>): Promise<void>;
  /** A workspace file's text, or none once it is gone. */
  textOf(file: string): Promise<string | undefined>;
  /** Stops the runtime, then the engine. */
  stop(): Promise<void>;
}

/** What a first chat left: what the model read first, the agent's files, and the status lines. */
export interface InterviewOutcome {
  readonly prefix: string | undefined;
  readonly strategy: string | undefined;
  readonly persona: string | undefined;
  readonly firstChat: string | undefined;
  readonly statusKeys: readonly string[];
}

// The engine's parts in the self-hosted composition.
function selfHostedParts() {
  const [composition] = skeletonCompositions;
  if (composition === undefined) {
    throw new Error("The skeleton has a self-hosted composition.");
  }
  return composition.parts();
}

// One `workspace_write` call of the model's.
function writeCall(id: string, file: string, text: string) {
  return { id, name: "workspace_write", args: { file, text } };
}

/**
 * The model's answers in a first chat: the agent asks each question in its own turn, then saves
 * both files with `workspace_write`, ends the first chat, and says so.
 */
export function interviewReplies(interview: Interview): SharedScript {
  const questions = interview.answers.map((_answer, index) => textReply(`Q${String(index + 1)}`));
  return createSharedScript([
    ...questions,
    callsReply([
      writeCall("strategy", "STRATEGY.md", interview.strategy),
      writeCall("persona", "PERSONA.md", interview.persona),
      { id: "end", name: "first_chat_end", args: {} },
    ]),
    textReply("Saved."),
  ]);
}

/**
 * Starts the engine with the agent's workspace made in the owner's language, and the agent
 * runtime on the script's replies, its agent database kept across a restart.
 */
export async function startFirstChat(locale: Locale, script: SharedScript): Promise<FirstChat> {
  const workspace = createMemoryWorkspaceFiles(createManualClock(1));
  const made = { agent: testAgent, name: "main", locale, timeZone: "UTC" };
  await makeAgentWorkspace(workspace, made, live().signal);
  const turns = createRunningTurns();
  const owner = () => ({ locale, timezone: "UTC" });
  const skeleton = await startSkeleton(selfHostedParts(), { turns, workspace, owner });
  const engine = { ...skeleton, stores: skeleton.parts.stores, server: skeleton.composed.server };
  const chat = watchChat(skeleton.client, testAgent);
  const runtimeScript = { replies: script.replies, database: createMemoryAgentDatabase() };
  const supervised = { current: superviseRuntime(engine, { turns, script: runtimeScript }) };
  return {
    skeleton,
    chat,
    restart: async (between) => {
      await supervised.current.stop(AbortSignal.timeout(10_000));
      await between?.();
      supervised.current = superviseRuntime(engine, { turns, script: runtimeScript });
    },
    textOf: async (file) => {
      const read = await workspace.read({ agent: testAgent, file }, live().signal);
      return read.ok ? read.value.text : undefined;
    },
    stop: async () => {
      await supervised.current.stop(AbortSignal.timeout(10_000));
      await skeleton.close();
    },
  };
}

/**
 * The owner's message, sent as the console sends one a second after the one before, and the end
 * of the turn it starts: the second refills the runtime's call budget at the engine.
 */
export async function say(machine: FirstChat, text: string, turn: number): Promise<void> {
  await machine.skeleton.clock.advance(1_000);
  await machine.skeleton.client.call("chat/post", { agent: testAgent, text }, live());
  await machine.chat.turnsEnded(turn);
}

/** A field of each push of a kind on the agent's chat topic, in order. */
export function pushed(chat: ChatWatch, kind: string, field: string): readonly string[] {
  return chat.pushes
    .filter((push) => push.kind === kind)
    .map(({ data }) => z.record(z.string(), z.unknown()).parse(data)[field])
    .map((value) => z.string().parse(value));
}

/** The owner's messages the model saw in a request, in order. */
export function ownerTexts(request: ModelRequest | undefined): readonly string[] {
  return (request?.messages ?? []).flatMap((message) =>
    message.role === "owner" ? [message.text] : [],
  );
}

/** Runs a whole first chat: "hi", then each answer, one turn each, and what it left. */
export async function runInterview(
  machine: FirstChat,
  interview: Interview,
  script: SharedScript,
): Promise<InterviewOutcome> {
  for (const [index, text] of ["hi", ...interview.answers].entries()) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- the owner answers one question at a time
    await say(machine, text, index + 1);
  }
  return {
    prefix: script.requests[0]?.prefix,
    strategy: await machine.textOf("STRATEGY.md"),
    persona: await machine.textOf("PERSONA.md"),
    firstChat: await machine.textOf("FIRST-CHAT.md"),
    statusKeys: pushed(machine.chat, "chat/status", "statusKey"),
  };
}
