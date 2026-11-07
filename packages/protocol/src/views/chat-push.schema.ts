import { z } from "zod";
import { type AgentMode, agentModeSchema } from "./agent-view.schema.js";
import { type WalletView, walletViewSchema } from "./wallet-view.schema.js";

/**
 * The most characters of reasoning one `turn/reasoning`, and so one `chat/reasoning`, carries;
 * the runtime cuts a longer one there (decision 0377).
 */
export const maxReasoningChars: number = 50_000;

/** A line's values, as `chat/status` and `chat/progress` carry them. */
type LineValues = Readonly<Record<string, string | number>>;

/** A push of an agent's chat topic, in the shapes of protocol spec section 7.7. */
export type ChatPush =
  | { readonly kind: "chat/turnStarted"; readonly agent: string; readonly turn: string }
  | {
      readonly kind: "chat/message";
      readonly agent: string;
      readonly turn: string;
      readonly text: string;
      readonly final: boolean;
    }
  | {
      readonly kind: "chat/status";
      readonly agent: string;
      readonly turn: string;
      readonly statusKey: string;
      readonly values?: LineValues;
    }
  | {
      readonly kind: "chat/progress";
      readonly agent: string;
      readonly turn: string;
      readonly progressKey: string;
      readonly values?: LineValues;
    }
  | {
      readonly kind: "chat/reasoning";
      readonly agent: string;
      readonly turn: string;
      readonly text: string;
      readonly final: boolean;
    }
  | {
      readonly kind: "chat/deposit";
      readonly agent: string;
      readonly turn: string;
      /** The agent's mode and freeze now, which a surface warns of beside each address. */
      readonly mode: AgentMode;
      readonly frozen: boolean;
      /** The wallets to show, each with the address its QR code holds (decision 0380). */
      readonly wallets: readonly WalletView[];
    }
  | { readonly kind: "chat/turnEnded"; readonly agent: string; readonly turn: string };

const at = { agent: z.string().min(1), turn: z.string().min(1) };
const values = z.record(z.string(), z.union([z.string(), z.number()])).optional();

const pushSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("chat/turnStarted"), data: z.looseObject(at) }),
  z.looseObject({
    kind: z.literal("chat/message"),
    data: z.looseObject({ ...at, text: z.string(), final: z.boolean() }),
  }),
  z.looseObject({
    kind: z.literal("chat/status"),
    data: z.looseObject({ ...at, statusKey: z.string().min(1), values }),
  }),
  z.looseObject({
    kind: z.literal("chat/progress"),
    data: z.looseObject({ ...at, progressKey: z.string().min(1), values }),
  }),
  z.looseObject({
    kind: z.literal("chat/reasoning"),
    data: z.looseObject({ ...at, text: z.string(), final: z.boolean() }),
  }),
  z.looseObject({
    kind: z.literal("chat/deposit"),
    data: z.looseObject({
      ...at,
      mode: agentModeSchema,
      frozen: z.boolean(),
      wallets: z.array(walletViewSchema).min(1),
    }),
  }),
  z.looseObject({ kind: z.literal("chat/turnEnded"), data: z.looseObject(at) }),
]);

/**
 * Reads a push of an agent's chat topic as a {@link ChatPush}; `undefined` for any other push,
 * such as an agent's question, and for one in a shape it cannot read.
 */
export function chatPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): ChatPush | undefined {
  const parsed = pushSchema.safeParse(push);
  if (!parsed.success) {
    return undefined;
  }
  const read = parsed.data;
  if (read.kind === "chat/message" || read.kind === "chat/reasoning") {
    const { agent, turn, text, final } = read.data;
    return { kind: read.kind, agent, turn, text, final };
  }
  if (read.kind === "chat/status") {
    const { agent, turn, statusKey, values: shown } = read.data;
    return {
      kind: read.kind,
      agent,
      turn,
      statusKey,
      ...(shown === undefined ? {} : { values: shown }),
    };
  }
  if (read.kind === "chat/progress") {
    const { agent, turn, progressKey, values: shown } = read.data;
    return {
      kind: read.kind,
      agent,
      turn,
      progressKey,
      ...(shown === undefined ? {} : { values: shown }),
    };
  }
  if (read.kind === "chat/deposit") {
    const { agent, turn, mode, frozen, wallets } = read.data;
    return { kind: read.kind, agent, turn, mode, frozen, wallets };
  }
  return { kind: read.kind, agent: read.data.agent, turn: read.data.turn };
}
