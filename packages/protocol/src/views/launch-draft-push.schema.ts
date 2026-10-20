import type { ErrorCode } from "@binference/core";
import { z } from "zod";
import { errorCodeSchema } from "../errors/protocol-error.js";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/** Parses a launch draft's id: 12 random bytes in base64url (decision 0285). */
export const launchDraftIdSchema: z.ZodType<string> = z.string().regex(/^[\w-]{16}$/);

/**
 * How a launch draft ended: `started`, its launch proposed by the owner's tap; `dropped` by the
 * owner; `expired` after 10 minutes; `replaced` by a newer draft of the agent; `failed`, the
 * owner's tap proposed nothing, with the code the proposal was refused with, or proposed a launch
 * that ended before its card, with its intent and its reason.
 */
type LaunchDraftOutcome = "started" | "dropped" | "expired" | "replaced" | "failed";

/** A push of an agent's chat topic about its launch draft (protocol spec, section 7.7). */
export type LaunchDraftPush =
  | {
      readonly kind: "chat/launchDraft";
      readonly agent: ProtocolId<"agent">;
      readonly draft: string;
      readonly expiresAt: number;
    }
  | {
      readonly kind: "chat/launchDraftClosed";
      readonly agent: ProtocolId<"agent">;
      readonly draft: string;
      readonly outcome: LaunchDraftOutcome;
      /** The launch's intent, once `started`. */
      readonly intent?: ProtocolId<"intent">;
      /** Why the tap proposed nothing, once `failed`. */
      readonly error?: ErrorCode;
      /** Why the launch the tap proposed ended before its card, once `failed` with an intent. */
      readonly reason?: string;
    };

const openedSchema = z.object({
  agent: protocolIdSchema("agent"),
  draft: launchDraftIdSchema,
  expiresAt: epochMsSchema,
});
const closedSchema = z.object({
  agent: protocolIdSchema("agent"),
  draft: launchDraftIdSchema,
  outcome: z.enum(["started", "dropped", "expired", "replaced", "failed"]),
  intent: protocolIdSchema("intent").exactOptional(),
  error: errorCodeSchema.exactOptional(),
  reason: z
    .string()
    .regex(/^[a-z][a-z_]*$/)
    .exactOptional(),
});

/**
 * Reads a push of an agent's chat topic as a {@link LaunchDraftPush}: `chat/launchDraft` for a new
 * draft, or `chat/launchDraftClosed` with how it ended. `undefined` for any other push, and for
 * one in a shape it cannot read.
 */
export function launchDraftPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): LaunchDraftPush | undefined {
  if (push.kind === "chat/launchDraft") {
    const opened = openedSchema.safeParse(push.data);
    return opened.success ? { kind: push.kind, ...opened.data } : undefined;
  }
  if (push.kind !== "chat/launchDraftClosed") {
    return undefined;
  }
  const closed = closedSchema.safeParse(push.data);
  return closed.success ? { kind: push.kind, ...closed.data } : undefined;
}
