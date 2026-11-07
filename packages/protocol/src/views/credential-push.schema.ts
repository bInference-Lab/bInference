import { z } from "zod";
import {
  type CredentialRequestView,
  credentialRequestViewSchema,
} from "../operations/credential-operations.schema.js";

/** How a credential request ended: stored, skipped by the owner, expired, or replaced by another. */
export type CredentialRequestOutcome = "stored" | "skipped" | "expired" | "replaced";

/** A push of a credential request on the agent's chat topic (decision 0388). */
export type CredentialPush =
  | {
      readonly kind: "chat/credentialRequest";
      readonly request: CredentialRequestView;
    }
  | {
      readonly kind: "chat/credentialRequestClosed";
      readonly agent: string;
      readonly request: string;
      readonly outcome: CredentialRequestOutcome;
    };

export type { CredentialRequestView };

const pushSchema = z.discriminatedUnion("kind", [
  z.looseObject({
    kind: z.literal("chat/credentialRequest"),
    data: credentialRequestViewSchema,
  }),
  z.looseObject({
    kind: z.literal("chat/credentialRequestClosed"),
    data: z.looseObject({
      agent: z.string().min(1),
      request: z.string().min(1),
      outcome: z.enum(["stored", "skipped", "expired", "replaced"]),
    }),
  }),
]);

/**
 * Reads a push of an agent's chat topic as a {@link CredentialPush}; `undefined` for any other
 * push and for one in a shape it cannot read.
 */
export function credentialPushOf(push: {
  readonly kind: string;
  readonly data: unknown;
}): CredentialPush | undefined {
  const parsed = pushSchema.safeParse(push);
  if (!parsed.success) {
    return undefined;
  }
  const read = parsed.data;
  if (read.kind === "chat/credentialRequest") {
    return { kind: read.kind, request: read.data };
  }
  const { agent, request, outcome } = read.data;
  return { kind: read.kind, agent, request, outcome };
}
