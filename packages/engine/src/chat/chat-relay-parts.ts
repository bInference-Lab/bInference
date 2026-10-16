import type { Clock, IdSource, Random } from "@binference/core";
import type { ProtocolId, PushTopic } from "@binference/protocol";
import type { ModelBudget } from "../billing/model-budget.js";
import type { AgentStore } from "../ports.js";
import type { PublishPush } from "../pushes/engine-push.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import { inboxPushData, inboxViewOf, type IntentViewOf } from "./inbox-views.js";
import type { AgentInboxStore, OwnerImageSource, QuestionStore } from "./ports.js";
import type { RunningTurns } from "./running-turns.js";

/** What the chat relay reads, writes and pushes through. */
export interface ChatRelayOptions {
  readonly agentInbox: AgentInboxStore;
  /** The agent's questions to the owner, answered with their message in one write. */
  readonly questions: QuestionStore;
  readonly agents: AgentStore;
  /** The runtime's running turns, and the token of its current start. */
  readonly turns: RunningTurns;
  /** Each agent's daily model budget: a turn starts only while some is left. */
  readonly budget: ModelBudget;
  readonly intentView: IntentViewOf;
  readonly ids: IdSource;
  /** The random bytes of each question's button reference. */
  readonly random: Random;
  readonly clock: Clock;
  readonly publish: PublishPush;
  /** The owner's images by the names messages give them; without it none can be read. */
  readonly images?: OwnerImageSource;
}

/** The topic of one agent's chat. */
export function chatTopic(agent: ProtocolId<"agent">): PushTopic {
  return `chat:${agent}`;
}

/** Pushes a stored message on the `inbox` topic, as `inbox/list` would give it. */
export async function pushInbox(
  options: ChatRelayOptions,
  message: AgentInboxMessage,
  signal: AbortSignal,
): Promise<void> {
  const view = await inboxViewOf(message, options.intentView, signal);
  options.publish({ topic: "inbox", kind: message.kind, data: inboxPushData(view) });
}
