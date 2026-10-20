import type { Id, JsonValue } from "@binference/core";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentInboxMessage } from "./agent-inbox-record.js";
import { type ChatRelayOptions, pushInbox } from "./chat-relay-parts.js";
import { createImageHandlers, type ImageHandlers } from "./image-handlers.js";
import { createImageHold } from "./image-hold.js";
import { createOwnerChatHandlers, type OwnerChatHandlers } from "./owner-chat-handlers.js";
import { createRuntimeChatHandlers, type RuntimeChatHandlers } from "./runtime-chat-handlers.js";

/** The chat operations the engine answers itself; the routed ones reach the runtime. */
export interface ChatHandlers extends OwnerChatHandlers, RuntimeChatHandlers, ImageHandlers {}

/** The engine's relay of chat between the surfaces and the agent runtime. */
export interface ChatRelay {
  readonly handlers: ChatHandlers;
  /**
   * Pushes a message another write stored on the `inbox` topic: an intent's settle message, or a
   * schedule's wake-up. A push that fails is dropped: the runtime reads every untaken message again
   * with `inbox/list` at its start.
   */
  settled(message: AgentInboxMessage): void;
  /**
   * Stores a stop for the running turn of the frozen agent, or of every agent when the whole
   * install froze, and pushes it (runtime spec, section 4.4). An agent with no running turn gets
   * none.
   */
  stopFrozen(agent: Id<"agt"> | undefined, signal: AbortSignal): Promise<void>;
  /** Wraps `safety/freeze` so a freeze that lands also stops the turns it froze. */
  freezing(freeze: EngineHandler<"safety/freeze">): EngineHandler<"safety/freeze">;
  /**
   * Stores the downtime re-check's `inbox/resumeReport` for an agent and pushes it (runtime spec,
   * section 3.3); one the agent's inbox has no room for, or an agent gone, gets none.
   */
  reportResume(
    agent: Id<"agt">,
    payload: JsonValue,
    options: { readonly signal: AbortSignal },
  ): Promise<void>;
}

// Stores a message the engine makes for an agent and pushes it; none when the inbox refused it.
async function addAndPush(
  options: ChatRelayOptions,
  message: {
    readonly agent: Id<"agt">;
    readonly kind: "inbox/stop" | "inbox/resumeReport";
    readonly payload: JsonValue;
  },
  signal: AbortSignal,
): Promise<void> {
  const { ids, clock } = options;
  const stored = await options.agentInbox.add(
    {
      id: ids.next("msg"),
      agentId: message.agent,
      kind: message.kind,
      payload: message.payload,
      atMs: clock.now(),
      opens: ids.next("ses"),
    },
    { signal },
  );
  if (stored.ok) {
    await pushInbox(options, stored.value, signal);
  }
}

async function stopOne(options: ChatRelayOptions, agent: Id<"agt">, signal: AbortSignal) {
  await addAndPush(options, { agent, kind: "inbox/stop", payload: { reason: "freeze" } }, signal);
}

// `inbox/readImage` over a hold of the owner's images, when the options name their source.
function imageHandlersOf(options: ChatRelayOptions): ImageHandlers {
  const { agentInbox, turns, images, clock } = options;
  const hold = images === undefined ? {} : { hold: createImageHold({ source: images, clock }) };
  return createImageHandlers({ agentInbox, turns, ...hold });
}

/** Creates the {@link ChatRelay} over the agent inbox, the agents and the running turns. */
export function createChatRelay(options: ChatRelayOptions): ChatRelay {
  const stopFrozen = async (agent: Id<"agt"> | undefined, signal: AbortSignal) => {
    const running = options.turns.agents();
    const frozen = agent === undefined ? running : running.filter((each) => each === agent);
    for (const each of frozen) {
      // oxlint-disable-next-line eslint/no-await-in-loop -- one write at a time, in order
      await stopOne(options, each, signal);
    }
  };
  return {
    handlers: {
      ...createOwnerChatHandlers(options),
      ...createRuntimeChatHandlers(options),
      ...imageHandlersOf(options),
    },
    settled(message) {
      void pushInbox(options, message, new AbortController().signal).catch(() => undefined);
    },
    stopFrozen,
    reportResume: async (agent, payload, { signal }) =>
      addAndPush(options, { agent, kind: "inbox/resumeReport", payload }, signal),
    freezing: (freeze) => async (call) => {
      const frozen = await freeze(call);
      if (frozen.ok) {
        await stopFrozen(call.args.agent, call.signal);
      }
      return frozen;
    },
  };
}
