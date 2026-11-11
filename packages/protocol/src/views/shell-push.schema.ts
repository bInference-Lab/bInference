import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import {
  type ShellRequestOutcome,
  shellRequestOutcomeSchema,
  type ShellRequestView,
  shellRequestViewSchema,
} from "./shell-request-view.schema.js";

/** How a shell request ended, as `chat/shellRequestClosed` carries it (decision 0409). */
export interface ShellRequestClosedPush {
  readonly kind: "chat/shellRequestClosed";
  readonly agent: ProtocolId<"agent">;
  readonly request: ProtocolId<"shellRequest">;
  readonly outcome: ShellRequestOutcome;
}

/** A push of an agent's chat topic about its shell request. */
export type ShellPush =
  | { readonly kind: "chat/shellRequest"; readonly view: ShellRequestView }
  | ShellRequestClosedPush;

const closedSchema = z.object({
  agent: protocolIdSchema("agent"),
  request: protocolIdSchema("shellRequest"),
  outcome: shellRequestOutcomeSchema,
});

/**
 * Reads a push of an agent's chat topic as a {@link ShellPush}: `chat/shellRequest` with the
 * request, or `chat/shellRequestClosed` with how it ended. `undefined` for any other push, and for
 * one in a shape it cannot read.
 */
export function shellPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): ShellPush | undefined {
  if (push.kind === "chat/shellRequest") {
    const view = shellRequestViewSchema.safeParse(push.data);
    return view.success ? { kind: push.kind, view: view.data } : undefined;
  }
  if (push.kind !== "chat/shellRequestClosed") {
    return undefined;
  }
  const closed = closedSchema.safeParse(push.data);
  return closed.success ? { kind: push.kind, ...closed.data } : undefined;
}
