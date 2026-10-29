import type { Clock, Id } from "@binference/core";
import type { InboxMessageView, IntentView, Locale } from "@binference/protocol";
import type { TranscriptEvent } from "@binference/store";
import { type ChatRunner, createChatRunner } from "../chats/chat-runner.js";
import { agentInstructions } from "../context/agent-instructions.js";
import type { ModelChain } from "../loop/ports.js";
import { turnLimits } from "../loop/turn-run.js";
import type { ContextSource, OwnerImageReader } from "../relay/ports.js";
import type { AgentStores } from "../sessions/agent-stores.js";
import { agentToolBox } from "../tools/agent-tools.js";
import type { ToolClient } from "../tools/tool-client.js";
import type { WebToolParts } from "../tools/web-tools.js";
import { createMemoryAgentStores, nthTestId } from "./memory-agent-stores.js";
import {
  type ChatPush,
  createMemoryEngineChat,
  type MemoryEngineChat,
} from "./memory-engine-chat.js";

/** What an evaluation chat runs the agent's turns on, in place of a running engine. */
export interface EvaluationChatOptions {
  /** The agent whose turns run; the operations and the context answer for it. */
  readonly agent: Id<"agt">;
  /** The owner's language, which binference's instructions name. */
  readonly locale: Locale;
  /** The model under evaluation, alone in its chain. */
  readonly models: ModelChain;
  /** The model that describes the owner's images, since the model under evaluation reads none. */
  readonly vision?: ModelChain;
  /** The images the owner's messages name. */
  readonly images?: OwnerImageReader;
  /** Answers every engine operation the agent's tools call. */
  readonly client: ToolClient;
  /** The workspace files and live facts each turn reads. */
  readonly context: ContextSource;
  /** How the web tools reach pages and search; without it, the agent has no web tools. */
  readonly web?: WebToolParts;
  readonly clock: Clock;
  /** The chat's lifetime: its turns end with it. */
  readonly signal: AbortSignal;
}

/**
 * One chat of one agent with the owner, for a model evaluation. Each step settles once every turn
 * it started has ended.
 */
export interface EvaluationChat {
  readonly agent: Id<"agt">;
  /** The owner writes, with the names of images or none. */
  say(text: string, images?: readonly string[]): Promise<void>;
  /** An intent the agent proposed reached a terminal state, as the engine tells the runtime. */
  settle(intent: IntentView): Promise<void>;
  /** Every event of the chat's sessions, in order. */
  events(): Promise<readonly TranscriptEvent[]>;
  /** How each turn that ended ended, in order: `ok`, `failed`, `stopped` and the others. */
  outcomes(): readonly string[];
  /** The status lines the turns showed the owner, by key, in order, such as `turn.failed.auth`. */
  statuses(): readonly string[];
}

const pageLimit = 1_000;
// Settle messages take ids past any the fake engine gives its own messages.
const settleIds = 0x1_0000_0000;

function runnerOf(
  options: EvaluationChatOptions,
  engine: MemoryEngineChat,
  stores: AgentStores,
): ChatRunner {
  return createChatRunner({
    stores,
    engine,
    turnContext: options.context,
    ...(options.images === undefined ? {} : { images: options.images }),
    setup: (place) => ({
      models: options.models,
      ...(options.vision === undefined ? {} : { vision: options.vision }),
      tools: agentToolBox({
        agent: options.agent,
        client: options.client,
        turn: place,
        ...(options.web === undefined ? {} : { web: options.web }),
      }),
      instructions: agentInstructions(options.locale),
      limits: turnLimits,
    }),
    mode: () => "merge",
    clock: options.clock,
    lifetime: options.signal,
  });
}

// The engine's settle message for an intent of the agent, in the session the owner wrote in last,
// under ids no message of the fake engine takes.
function settleMessage(
  agent: Id<"agt">,
  intent: IntentView,
  place: { readonly session: Id<"ses">; readonly nth: number },
): InboxMessageView {
  return {
    kind: "inbox/intentSettled",
    message: nthTestId("msg", settleIds + place.nth),
    agent,
    session: place.session,
    at: 1_000,
    turn: nthTestId("trn", settleIds + place.nth),
    intent,
  };
}

/**
 * Starts an evaluation chat: the runtime's own chat runner, turn loop, tools and instructions
 * (runtime spec, sections 4 to 7), on in-memory stores and the engine's side of chat held in
 * memory, with the model, the operations' answers and the context the caller gives. No turn
 * compacts its history.
 */
export async function startEvaluationChat(options: EvaluationChatOptions): Promise<EvaluationChat> {
  const { agent } = options;
  const engine = createMemoryEngineChat([agent]);
  const { stores } = await createMemoryAgentStores();
  const runner = runnerOf(options, engine, stores);
  // The runner takes each message the engine pushes; a step waits for its taking, then its turns.
  const last = { taking: Promise.resolve(), session: nthTestId("ses", 0), settles: 0 };
  engine.watchInbox({
    onMessage: (view) => {
      last.taking = runner.receive(view);
    },
    refetch: async () => Promise.resolve(),
  });
  const sessions = new Set<Id<"ses">>();
  const detailsOf = (kind: ChatPush["kind"]): readonly string[] =>
    engine.pushes.filter((push) => push.kind === kind).map((push) => push.detail ?? "unknown");
  const step = async (): Promise<void> => {
    await last.taking;
    await runner.rested();
  };
  return {
    agent,
    async say(text, images) {
      last.session = engine.post(agent, text, images).session;
      sessions.add(last.session);
      await step();
    },
    async settle(intent) {
      last.settles += 1;
      const place = { session: last.session, nth: last.settles };
      last.taking = runner.receive(settleMessage(agent, intent, place));
      await step();
    },
    async events() {
      const read = [...sessions].map(async (sessionId) =>
        stores.transcript.events({ sessionId, limit: pageLimit }, { signal: options.signal }),
      );
      return (await Promise.all(read)).flat();
    },
    outcomes: () => detailsOf("chat/turnEnded"),
    statuses: () => detailsOf("chat/status"),
  };
}
