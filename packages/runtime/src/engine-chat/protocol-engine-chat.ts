import type { ProtocolClient } from "@binference/client";
import { BinferenceError } from "@binference/core";
import { inboxMessageViewSchema } from "@binference/protocol";
import type { TurnStartAnswer } from "./engine-chat-records.js";
import type { EngineChat } from "./ports.js";

/** The protocol client calls the engine's side of chat makes. */
export type ChatClient = Pick<ProtocolClient, "call" | "subscribe">;

type Refusal = Extract<TurnStartAnswer, { readonly started: false }>["refusal"];

const refusals: ReadonlyMap<string, Refusal> = new Map([
  ["agent.budget", "budget"],
  ["agent.frozen", "frozen"],
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

function turnCalls(
  client: ChatClient,
): Pick<EngineChat, "markTurn" | "sayTurn" | "turnStatus" | "recordUsage" | "endTurn"> {
  return {
    async markTurn({ agent, turn }, signal) {
      await client.call("turn/mark", { agent, turn }, { signal });
    },
    async sayTurn(say, signal) {
      await client.call("turn/say", { ...say }, { signal });
    },
    async turnStatus({ agent, turn, statusKey, values }, signal) {
      const args = {
        agent,
        turn,
        statusKey,
        ...(values === undefined ? {} : { values: { ...values } }),
      };
      await client.call("turn/status", args, { signal });
    },
    async recordUsage({ key, ...usage }, signal) {
      const { budgetLeftMicros, resumesAt } = await client.call("usage/record", usage, {
        signal,
        key,
      });
      return { budgetLeftMicros, ...(resumesAt === undefined ? {} : { resumesAt }) };
    },
    async endTurn(end, signal) {
      await client.call("turn/end", { ...end }, { signal });
    },
  };
}

/**
 * The engine's side of chat over the runtime's protocol client (runtime spec, sections 3.2 and
 * 4.3): the `inbox` topic and `inbox/list`, `inbox/take` and the `turn/*` operations. A message
 * kind the runtime does not know is skipped; `turn/start` refused with `agent.budget`,
 * `agent.frozen`, `agent.archived` or `agent.not_found` answers the refusal, and any other failure
 * rejects.
 */
export function createProtocolEngineChat(client: ChatClient): EngineChat {
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
      const page = await client.call("inbox/list", args, { signal });
      return { items: page.items, ...(page.next === undefined ? {} : { next: page.next }) };
    },
    async takeInbox(messages, signal) {
      await client.call("inbox/take", { messages: [...messages] }, { signal });
    },
    async startTurn(start, signal) {
      try {
        const args = { ...start, messages: [...start.messages] };
        const started = await client.call("turn/start", args, { signal });
        return { started: true, budgetLeftMicros: started.budgetLeftMicros };
      } catch (error) {
        const refused = error instanceof Error ? refusalOf(error) : undefined;
        if (refused === undefined) {
          throw error;
        }
        return refused;
      }
    },
    ...turnCalls(client),
  };
}
