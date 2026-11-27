import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { inboxMessageViewSchema } from "@binference/protocol";
import type { CallClient } from "./call-slots.js";
import type { TurnStartAnswer } from "./engine-chat-records.js";
import type { EngineChat } from "./ports.js";

/** The protocol client calls the engine's side of chat makes. */
export type ChatClient = Pick<ProtocolClient, "call" | "subscribe">;

type Refusal = Extract<TurnStartAnswer, { readonly started: false }>["refusal"];

const refusals: ReadonlyMap<string, Refusal> = new Map([
  ["agent.budget", "budget"],
  ["quota.turns", "quota"],
  ["agent.frozen", "frozen"],
  // The breaker holds the install as a freeze holds an agent (decision 0441).
  ["safety.breaker", "frozen"],
  ["agent.archived", "archived"],
  ["agent.not_found", "not_found"],
]);

const pageSize = 50;

// A refusal of `turn/start` for its agent's state; any other failure is the engine out of reach.
function refusalOf(error: Error): TurnStartAnswer | undefined {
  const refusal = error instanceof BinferenceError ? refusals.get(error.code) : undefined;
  if (refusal === undefined || !(error instanceof BinferenceError)) {
    return undefined;
  }
  const resumesAt = error.details["resumesAt"];
  return {
    started: false,
    refusal,
    ...(typeof resumesAt === "number" ? { resumesAt } : {}),
  };
}

// The calls of a turn: the closing ones through `resending`, which sends again a call the engine
// refused before it ran, each write under one key named by its turn (decision 0442); a draft goes
// once, since the next one replaces it.
function turnCalls(
  client: ChatClient,
  resending: CallClient,
): Pick<
  EngineChat,
  | "markTurn"
  | "sayTurn"
  | "turnStatus"
  | "turnProgress"
  | "turnReasoning"
  | "recordUsage"
  | "endTurn"
> {
  return {
    ...lineCalls(client, resending),
    async markTurn({ agent, turn }, signal) {
      await resending.call("turn/mark", { agent, turn }, { signal });
    },
    async sayTurn(say, signal) {
      if (say.final) {
        await resending.call("turn/say", { ...say }, { signal, key: `${say.turn}.say` });
        return;
      }
      await client.call("turn/say", { ...say }, { signal });
    },
    async recordUsage({ key, ...usage }, signal) {
      const { budgetLeftMicros, resumesAt } = await resending.call("usage/record", usage, {
        signal,
        key,
      });
      return { budgetLeftMicros, ...(resumesAt === undefined ? {} : { resumesAt }) };
    },
    async endTurn(end, signal) {
      await resending.call("turn/end", { ...end }, { signal, key: `${end.turn}.end` });
    },
  };
}

// The lines a turn shows: its status line, sent again when refused before it ran, and its
// progress lines and its model's reasoning, which go once.
function lineCalls(
  client: ChatClient,
  resending: CallClient,
): Pick<EngineChat, "turnStatus" | "turnProgress" | "turnReasoning"> {
  return {
    async turnStatus({ agent, turn, statusKey, values, httpStatus }, signal) {
      const args = {
        agent,
        turn,
        statusKey,
        ...(values === undefined ? {} : { values: { ...values } }),
        ...(httpStatus === undefined ? {} : { httpStatus }),
      };
      await resending.call("turn/status", args, { signal });
    },
    async turnProgress({ agent, turn, progressKey, values }, signal) {
      const args = {
        agent,
        turn,
        progressKey,
        ...(values === undefined ? {} : { values: { ...values } }),
      };
      await client.call("turn/progress", args, { signal });
    },
    async turnReasoning({ agent, turn, text, final }, signal) {
      await client.call("turn/reasoning", { agent, turn, text, final }, { signal });
    },
  };
}

/**
 * The engine's side of chat over the runtime's protocol client (runtime spec, sections 3.2 and
 * 4.3): the `inbox` topic and `inbox/list`, `inbox/take` and the `turn/*` operations. A message
 * kind the runtime does not know is skipped; `turn/start` refused with `agent.budget`,
 * `agent.frozen`, `agent.archived` or `agent.not_found` answers the refusal, and any other failure
 * rejects. Every call but a draft, a progress line and reasoning goes through `resending`, which
 * sends again a call the engine refused before it ran (decision 0442).
 */
export function createProtocolEngineChat(client: ChatClient, resending: CallClient): EngineChat {
  return {
    watchInbox: (watch) =>
      client.subscribe("inbox", {
        onPush: (push) => {
          const parsed = inboxMessageViewSchema.safeParse(push.data);
          if (parsed.success) {
            watch.onMessage(parsed.data);
          }
        },
        refetch: watch.refetch,
      }),
    async listInbox(cursor, signal) {
      const args = { limit: pageSize, ...(cursor === undefined ? {} : { cursor }) };
      const page = await resending.call("inbox/list", args, { signal });
      return { items: page.items, ...(page.next === undefined ? {} : { next: page.next }) };
    },
    async takeInbox(messages, signal) {
      await resending.call("inbox/take", { messages: [...messages] }, { signal });
    },
    async startTurn(start, signal) {
      try {
        const args = { ...start, messages: [...start.messages] };
        const started = await resending.call("turn/start", args, { signal });
        return { started: true, budgetLeftMicros: started.budgetLeftMicros };
      } catch (error) {
        const refused = error instanceof Error ? refusalOf(error) : undefined;
        if (refused === undefined) {
          throw error;
        }
        return refused;
      }
    },
    ...turnCalls(client, resending),
  };
}
