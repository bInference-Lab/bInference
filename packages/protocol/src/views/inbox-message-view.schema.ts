import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import {
  type AlertFire,
  alertFireSchema,
  type AlertView,
  alertViewSchema,
} from "./alert-view.schema.js";
import { type IntentView, intentViewSchema } from "./intent-view.schema.js";
import type { OrderView } from "./order-view.schema.js";

/** The chat surface an owner's message came from. */
export type ChatSurface = "telegram" | "console" | "cli" | "mini";

/** What every message of the agent inbox carries (runtime spec, section 3.3). */
interface InboxMessageBase {
  readonly message: ProtocolId<"inboxMessage">;
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly at: number;
}

/** The owner wrote on a surface: it starts a turn, or joins the running one. */
interface InboxOwnerMessage extends InboxMessageBase {
  readonly kind: "inbox/message";
  /** The turn the engine reserved for it, left unused when the message joins a running turn. */
  readonly turn: ProtocolId<"chatTurn">;
  readonly text: string;
  /** Upload ids of the message's images; a message with images is outside content. */
  readonly images?: readonly string[];
  readonly surface: ChatSurface;
  /** The question a press of its button answers, and the place of the choice pressed. */
  readonly answer?: InboxAnswer;
}

/** A press of a question's button, as the message that answers it carries it. */
interface InboxAnswer {
  readonly question: ProtocolId<"question">;
  readonly choice: number;
}

/** An intent the agent runtime proposed reached a terminal state: it starts a turn. */
interface InboxIntentSettled extends InboxMessageBase {
  readonly kind: "inbox/intentSettled";
  readonly turn: ProtocolId<"chatTurn">;
  readonly intent: IntentView;
}

/** The owner stopped the agent, or a freeze did: the running turn ends. */
interface InboxStop extends InboxMessageBase {
  readonly kind: "inbox/stop";
  readonly reason: "owner" | "freeze";
}

/** The owner cleared the chat: the running turn ends and `next` is the session that follows. */
interface InboxClear extends InboxMessageBase {
  readonly kind: "inbox/clear";
  readonly next: ProtocolId<"chatSession">;
}

/**
 * A schedule's time came: it starts a turn with the schedule's prompt, marked when the schedule
 * was set in a turn that held outside content (decision 0232).
 */
interface InboxScheduleDue extends InboxMessageBase {
  readonly kind: "inbox/scheduleDue";
  readonly turn: ProtocolId<"chatTurn">;
  readonly schedule: ProtocolId<"schedule">;
  readonly prompt: string;
  /** When the run was due; earlier than `at` for a run missed while the engine was off. */
  readonly due: number;
  readonly outsideContent: boolean;
}

/**
 * An alert with `wake` fired: it starts a turn with the alert and what fired it, marked when
 * `outsideContent` is set (protocol spec, section 8.4).
 */
interface InboxAlertFired extends InboxMessageBase {
  readonly kind: "inbox/alertFired";
  readonly turn: ProtocolId<"chatTurn">;
  readonly alert: AlertView;
  readonly fired: AlertFire;
  readonly outsideContent: boolean;
}

/** One auto order the downtime re-check checked: filled, or skipped and why. */
interface ResumeReportOrder {
  readonly order: ProtocolId<"autoOrder">;
  readonly kind: OrderView["kind"];
  readonly outcome: "filled" | "skipped";
  /** The skip's reason code, whose message is `reason.<code>`. */
  readonly reason?: string;
}

/**
 * The engine was off, or its machine asleep, and re-checked the agent's auto orders (decision
 * 0267): it starts no turn, and the agent's next turn reads it.
 */
interface InboxResumeReport extends InboxMessageBase {
  readonly kind: "inbox/resumeReport";
  /** `start` when the engine started again, `wake` when the machine woke from sleep. */
  readonly cause: "start" | "wake";
  /** When the engine last ran before it. */
  readonly offFrom: number;
  /** How long the engine was off or asleep. */
  readonly offMs: number;
  /** The agent's own orders: checked is filled plus skipped. */
  readonly checked: number;
  readonly filled: number;
  readonly skipped: number;
  /** Each checked order, at most 50. */
  readonly orders: readonly ResumeReportOrder[];
}

/**
 * One stored message of the agent inbox, as `inbox/list` and the `inbox` topic carry it. Kinds
 * the runtime spec adds later arrive as further members; a runtime skips a kind it does not know.
 */
export type InboxMessageView =
  | InboxOwnerMessage
  | InboxIntentSettled
  | InboxStop
  | InboxClear
  | InboxScheduleDue
  | InboxAlertFired
  | InboxResumeReport;

const base = {
  message: protocolIdSchema("inboxMessage"),
  agent: protocolIdSchema("agent"),
  session: protocolIdSchema("chatSession"),
  at: epochMsSchema,
};

const turn = protocolIdSchema("chatTurn");

/** Parses a chat surface. */
export const chatSurfaceSchema: z.ZodType<ChatSurface, string> = z.enum([
  "telegram",
  "console",
  "cli",
  "mini",
]);

/** Parses one message of the agent inbox. */
export const inboxMessageViewSchema: z.ZodType<InboxMessageView> = z.discriminatedUnion("kind", [
  z.object({
    ...base,
    kind: z.literal("inbox/message"),
    turn,
    text: z.string(),
    images: z.array(plainIdSchema).min(1).max(4).exactOptional(),
    surface: chatSurfaceSchema,
    answer: z
      .object({ question: protocolIdSchema("question"), choice: z.int().min(0).max(3) })
      .exactOptional(),
  }),
  z.object({ ...base, kind: z.literal("inbox/intentSettled"), turn, intent: intentViewSchema }),
  z.object({ ...base, kind: z.literal("inbox/stop"), reason: z.enum(["owner", "freeze"]) }),
  z.object({ ...base, kind: z.literal("inbox/clear"), next: protocolIdSchema("chatSession") }),
  z.object({
    ...base,
    kind: z.literal("inbox/scheduleDue"),
    turn,
    schedule: protocolIdSchema("schedule"),
    prompt: z.string(),
    due: epochMsSchema,
    outsideContent: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal("inbox/alertFired"),
    turn,
    alert: alertViewSchema,
    fired: alertFireSchema,
    outsideContent: z.boolean(),
  }),
  z.object({
    ...base,
    kind: z.literal("inbox/resumeReport"),
    cause: z.enum(["start", "wake"]),
    offFrom: epochMsSchema,
    offMs: z.int().nonnegative(),
    checked: z.int().nonnegative(),
    filled: z.int().nonnegative(),
    skipped: z.int().nonnegative(),
    orders: z
      .array(
        z.object({
          order: protocolIdSchema("autoOrder"),
          kind: z.enum(["limit", "takeProfit", "stopLoss", "trailing", "dca", "copy"]),
          outcome: z.enum(["filled", "skipped"]),
          reason: z
            .string()
            .regex(/^[a-z][a-z_]*$/)
            .exactOptional(),
        }),
      )
      .max(50),
  }),
]);
