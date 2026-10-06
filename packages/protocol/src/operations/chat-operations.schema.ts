import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type AgentArgs, agentArgsSchema } from "../values/agent-args.schema.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type Page, type PageArgs, pageArgsShape, pageSchema } from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { readFlags, routedReadFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** The args of `chat/post`: the owner's message, with at most 4 uploaded images. */
interface PostArgs extends AgentArgs {
  readonly text: string;
  readonly images?: readonly string[];
}

/** The session and turn a message started. */
interface TurnRef {
  readonly session: ProtocolId<"chatSession">;
  readonly turn: ProtocolId<"chatTurn">;
}

/** The args of `chat/messages`: a session's messages, or the current session's. */
interface MessagesArgs extends AgentArgs, PageArgs {
  readonly session?: ProtocolId<"chatSession">;
}

/** One message of a chat transcript. */
interface ChatMessageView {
  readonly session: ProtocolId<"chatSession">;
  readonly turn?: ProtocolId<"chatTurn">;
  readonly seq: number;
  readonly role: "owner" | "agent" | "tool" | "system";
  readonly kind: "text" | "tool_call" | "tool_result" | "image" | "summary";
  readonly text?: string;
  readonly at: number;
}

/** The args of `turn/say`: a draft edited in place until `final`. */
interface SayArgs extends AgentArgs, TurnRef {
  readonly text: string;
  readonly final: boolean;
}

/** The args of `turn/status`: an i18n key for the turn's status line and its values. */
interface StatusArgs extends AgentArgs {
  readonly turn: ProtocolId<"chatTurn">;
  readonly statusKey: string;
  readonly values?: Readonly<Record<string, string | number>>;
}

/** The args of `turn/end`. */
interface EndTurnArgs extends AgentArgs {
  readonly turn: ProtocolId<"chatTurn">;
  readonly outcome: "ok" | "stopped" | "failed" | "budget" | "loop";
}

/** The args of `usage/record`: one model call's tokens and cost. */
interface RecordUsageArgs extends AgentArgs {
  readonly turn: ProtocolId<"chatTurn">;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros: bigint;
}

/** The args of `usage/get`: one agent, or every agent when absent, over a time range. */
interface UsageArgs {
  readonly agent?: ProtocolId<"agent">;
  readonly from: number;
  readonly to: number;
}

/** One day's spend on one model. `dayAt` is the day's start in the owner's timezone. */
interface UsageRow {
  readonly agent: ProtocolId<"agent">;
  readonly dayAt: number;
  readonly model: string;
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cachedTokens: number;
  readonly usdMicros: bigint;
}

/** An agent's daily model budget and what is left of it today. */
interface UsageBudget {
  readonly agent: ProtocolId<"agent">;
  readonly dailyUsdMicros: bigint;
  readonly leftUsdMicros: bigint;
}

/** The answer of `usage/get`: spend by day and model, and each agent's budget. */
interface UsageView {
  readonly rows: readonly UsageRow[];
  readonly budgets: readonly UsageBudget[];
}

/** The chat, turn and usage operations of protocol spec section 7.7. */
export interface ChatOperationShapes {
  readonly "chat/post": { readonly args: PostArgs; readonly result: TurnRef };
  readonly "chat/messages": { readonly args: MessagesArgs; readonly result: Page<ChatMessageView> };
  readonly "chat/stop": { readonly args: AgentArgs; readonly result: Empty };
  readonly "chat/clear": {
    readonly args: AgentArgs;
    readonly result: { readonly session: ProtocolId<"chatSession"> };
  };
  readonly "turn/say": { readonly args: SayArgs; readonly result: Empty };
  readonly "turn/status": { readonly args: StatusArgs; readonly result: Empty };
  readonly "turn/end": { readonly args: EndTurnArgs; readonly result: Empty };
  readonly "usage/record": {
    readonly args: RecordUsageArgs;
    /** What is left of today's model budget; 0 once it is spent. */
    readonly result: { readonly budgetLeftMicros: bigint };
  };
  readonly "usage/get": { readonly args: UsageArgs; readonly result: UsageView };
}

const agent = protocolIdSchema("agent");
const turn = protocolIdSchema("chatTurn");
const session = protocolIdSchema("chatSession");
const tokens = z.int().nonnegative();
const model = z.string().min(1).max(128);

/** The chat, turn and usage operations, by name. */
export const chatOperations: OperationTable<ChatOperationShapes> = {
  "chat/post": {
    ...writeFlags,
    name: "chat/post",
    scope: "chat",
    args: z.strictObject({
      agent,
      text: z.string(),
      images: z.array(plainIdSchema).min(1).max(4).exactOptional(),
    }),
    result: z.object({ session, turn }),
  },
  "chat/messages": {
    ...routedReadFlags,
    name: "chat/messages",
    scope: "read",
    args: z.strictObject({ ...pageArgsShape, agent, session: session.exactOptional() }),
    result: pageSchema(
      z.object({
        session,
        turn: turn.exactOptional(),
        seq: z.int().nonnegative(),
        role: z.enum(["owner", "agent", "tool", "system"]),
        kind: z.enum(["text", "tool_call", "tool_result", "image", "summary"]),
        text: z.string().exactOptional(),
        at: epochMsSchema,
      }),
    ),
  },
  "chat/stop": {
    ...writeFlags,
    name: "chat/stop",
    scope: "chat",
    args: agentArgsSchema,
    result: emptyResultSchema,
  },
  "chat/clear": {
    ...writeFlags,
    name: "chat/clear",
    scope: "chat",
    args: agentArgsSchema,
    result: z.object({ session }),
  },
  "turn/say": {
    ...writeFlags,
    name: "turn/say",
    scope: "agent",
    args: z.strictObject({ agent, session, turn, text: z.string(), final: z.boolean() }),
    result: emptyResultSchema,
  },
  "turn/status": {
    ...readFlags,
    name: "turn/status",
    scope: "agent",
    args: z.strictObject({
      agent,
      turn,
      statusKey: z.string().regex(/^[a-z][a-zA-Z0-9]*(?:\.[a-z][a-zA-Z0-9]*)+$/),
      values: z.record(z.string(), z.union([z.string(), z.number()])).exactOptional(),
    }),
    result: emptyResultSchema,
  },
  "turn/end": {
    ...writeFlags,
    name: "turn/end",
    scope: "agent",
    args: z.strictObject({
      agent,
      turn,
      outcome: z.enum(["ok", "stopped", "failed", "budget", "loop"]),
    }),
    result: emptyResultSchema,
  },
  "usage/record": {
    ...writeFlags,
    name: "usage/record",
    scope: "agent",
    args: z.strictObject({
      agent,
      turn,
      model,
      inputTokens: tokens,
      outputTokens: tokens,
      cachedTokens: tokens,
      usdMicros: decimalStringSchema,
    }),
    result: z.object({ budgetLeftMicros: decimalStringSchema }),
  },
  "usage/get": {
    ...readFlags,
    name: "usage/get",
    scope: "read",
    args: z.strictObject({ agent: agent.exactOptional(), from: epochMsSchema, to: epochMsSchema }),
    result: z.object({
      rows: z.array(
        z.object({
          agent,
          dayAt: epochMsSchema,
          model,
          inputTokens: tokens,
          outputTokens: tokens,
          cachedTokens: tokens,
          usdMicros: decimalStringSchema,
        }),
      ),
      budgets: z.array(
        z.object({
          agent,
          dailyUsdMicros: decimalStringSchema,
          leftUsdMicros: decimalStringSchema,
        }),
      ),
    }),
  },
};
