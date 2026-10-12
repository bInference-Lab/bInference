import type { Id } from "@binference/core";
import { createManualClock, type ManualClock } from "@binference/core/testing";
import type { InboxMessageView } from "@binference/protocol";
import type { MemoryAgentDatabase } from "@binference/store/testing";
import { type ChatRunner, createChatRunner } from "../chats/chat-runner.js";
import type { NewMessageMode } from "../chats/queue-merge.js";
import type { ModelChain } from "../loop/ports.js";
import { type TestTool, testToolBox } from "../loop/test-turns.js";
import { turnLimits } from "../loop/turn-run.js";
import type { ContextSource } from "../relay/ports.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import { createMemoryAgentStores, nthTestId } from "./memory-agent-stores.js";
import { createMemoryContextSource } from "./memory-context-source.js";
import { createMemoryEngineChat, type MemoryEngineChat } from "./memory-engine-chat.js";
import {
  createScriptedTransport,
  oneModelChain,
  type ScriptedReply,
  type ScriptedTransport,
} from "./scripted-transport.js";

/** A chat runner on a fake engine, in-memory stores, a scripted model and test tools. */
export interface ChatRig {
  readonly agent: Id<"agt">;
  readonly engine: MemoryEngineChat;
  /** The stores the runner writes with, and the rows they share. */
  readonly stores: AgentStores;
  readonly database: MemoryAgentDatabase;
  readonly runner: ChatRunner;
  readonly transport: ScriptedTransport;
  readonly clock: ManualClock;
  /** The owner posts; settles once the runner took the message, not once its turn ended. */
  post(text: string): Promise<{
    readonly message: Id<"msg">;
    readonly session: Id<"ses">;
    readonly turn: Id<"trn">;
  }>;
  /** The last message the runner took, or is taking. */
  received(): Promise<void>;
}

/** What a chat rig starts from. */
export interface ChatRigOptions {
  readonly replies: readonly ScriptedReply[];
  readonly tools?: readonly TestTool[] | ((rig: () => ChatRig) => readonly TestTool[]);
  readonly mode?: NewMessageMode;
  /** The stores of a runtime that started again, on the rows of the one before. */
  readonly restarted?: { readonly stores: AgentStores; readonly database: MemoryAgentDatabase };
  readonly engine?: MemoryEngineChat;
  /** The workspace files and live facts the turns read; none and a paper agent's when absent. */
  readonly context?: ContextSource;
  /** The turns' models in place of one scripted model answering `replies`. */
  readonly models?: (clock: ManualClock) => ModelChain;
}

function notStarted(): never {
  throw new Error("The chat rig has not started yet.");
}

// The runner takes each message the fake engine pushes; answers the last taking.
function takeEveryPush(engine: MemoryEngineChat, runner: ChatRunner): { taking: Promise<void> } {
  const last = { taking: Promise.resolve() };
  engine.watchInbox({
    onMessage: (view: InboxMessageView) => {
      last.taking = runner.receive(view);
    },
    refetch: async () => Promise.resolve(),
  });
  return last;
}

/** Starts a chat rig whose runner takes every pushed message of the fake engine. */
export async function startChatRig(options: ChatRigOptions): Promise<ChatRig> {
  const agent = nthTestId("agt", 1);
  const engine = options.engine ?? createMemoryEngineChat([agent]);
  const { stores, database } = options.restarted ?? (await createMemoryAgentStores());
  const transport = createScriptedTransport(options.replies);
  const clock = createManualClock(10_000);
  const holder: { rig?: ChatRig } = {};
  const rigNow = (): ChatRig => holder.rig ?? notStarted();
  const tools = typeof options.tools === "function" ? options.tools(rigNow) : (options.tools ?? []);
  const runner = createChatRunner({
    stores,
    engine,
    turnContext: options.context ?? createMemoryContextSource({ now: () => clock.now() }),
    setup: () => ({
      models: options.models?.(clock) ?? oneModelChain(transport, clock),
      tools: testToolBox(tools),
      instructions: "You are a test agent.",
      limits: turnLimits,
    }),
    mode: () => options.mode ?? "merge",
    clock,
    lifetime: new AbortController().signal,
  });
  const last = takeEveryPush(engine, runner);
  const rig: ChatRig = {
    agent,
    engine,
    stores,
    database,
    runner,
    transport,
    clock,
    async post(text) {
      const posted = engine.post(agent, text);
      await last.taking;
      return posted;
    },
    received: async () => last.taking,
  };
  holder.rig = rig;
  return rig;
}
