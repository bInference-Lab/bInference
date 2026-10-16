import { z } from "zod";

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
      readonly values?: Readonly<Record<string, string | number>>;
    }
  | { readonly kind: "chat/turnEnded"; readonly agent: string; readonly turn: string };

const at = { agent: z.string().min(1), turn: z.string().min(1) };

const pushSchema = z.discriminatedUnion("kind", [
  z.looseObject({ kind: z.literal("chat/turnStarted"), data: z.looseObject(at) }),
  z.looseObject({
    kind: z.literal("chat/message"),
    data: z.looseObject({ ...at, text: z.string(), final: z.boolean() }),
  }),
  z.looseObject({
    kind: z.literal("chat/status"),
    data: z.looseObject({
      ...at,
      statusKey: z.string().min(1),
      values: z.record(z.string(), z.union([z.string(), z.number()])).optional(),
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
  if (read.kind === "chat/message") {
    const { agent, turn, text, final } = read.data;
    return { kind: read.kind, agent, turn, text, final };
  }
  if (read.kind === "chat/status") {
    const { agent, turn, statusKey, values } = read.data;
    return { kind: read.kind, agent, turn, statusKey, ...(values === undefined ? {} : { values }) };
  }
  return { kind: read.kind, agent: read.data.agent, turn: read.data.turn };
}
