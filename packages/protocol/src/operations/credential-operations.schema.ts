import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import type { TurnRef } from "./chat-operations.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/** The limits of a credential: its name, its value, its hosts and the agent's reason. */
const credentialLimits: {
  readonly nameChars: number;
  readonly valueBytes: number;
  readonly hosts: number;
  readonly hostChars: number;
  readonly reasonChars: number;
} = {
  nameChars: 64,
  valueBytes: 65_536,
  hosts: 16,
  hostChars: 253,
  reasonChars: 300,
};

/**
 * A stored credential as anyone may read it (decision 0388): its name, the exact hosts it may be
 * sent to, and when the owner last stored it. Its value is never read back.
 */
interface CredentialView {
  readonly name: string;
  readonly allowedHosts: readonly string[];
  readonly updatedAt: number;
}

/**
 * The agent's request for a credential (decision 0388): the name it would be stored under, the
 * agent's reason, the hosts it proposes, whether one of the name is stored, and until when the
 * owner may answer.
 */
export interface CredentialRequestView {
  readonly request: ProtocolId<"credentialRequest">;
  readonly agent: ProtocolId<"agent">;
  readonly session: ProtocolId<"chatSession">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly name: string;
  readonly reason?: string;
  readonly allowedHosts: readonly string[];
  /** When a credential of the name is stored, when the owner last stored it. */
  readonly updatedAt?: number;
  readonly createdAt: number;
  readonly closesAt: number;
}

/** The args of `turn/credential`: the agent asks the owner for a credential in its turn. */
interface RequestArgs extends AgentArgs, TurnRef {
  readonly name: string;
  readonly reason?: string;
  readonly allowedHosts?: readonly string[];
  /** How long the owner has to answer, 30 to 3600 seconds; 900 when absent. */
  readonly timeoutSeconds?: number;
}

/** The args of `credential/answer`: the owner's value and the hosts it may be sent to. */
interface AnswerArgs extends AgentArgs {
  readonly request: ProtocolId<"credentialRequest">;
  readonly value: string;
  readonly allowedHosts: readonly string[];
}

/** The args of `credential/set`: the owner stores a credential with no request. */
interface SetArgs {
  readonly name: string;
  readonly value: string;
  readonly allowedHosts: readonly string[];
}

/** The operations of the credentials the owner stores for the agent (decision 0388). */
export interface CredentialOperationShapes {
  readonly "turn/credential": {
    readonly args: RequestArgs;
    readonly result: CredentialRequestView;
  };
  readonly "credential/answer": {
    readonly args: AnswerArgs;
    readonly result: TurnRef;
  };
  readonly "credential/skip": {
    readonly args: AgentArgs & {
      readonly request: ProtocolId<"credentialRequest">;
    };
    readonly result: TurnRef;
  };
  readonly "chat/openCredentialRequest": {
    readonly args: AgentArgs;
    readonly result: { readonly request?: CredentialRequestView };
  };
  readonly "credential/list": {
    readonly args: Readonly<Record<string, never>>;
    readonly result: { readonly items: readonly CredentialView[] };
  };
  readonly "credential/delete": {
    readonly args: { readonly name: string };
    readonly result: { readonly name: string };
  };
  readonly "credential/set": {
    readonly args: SetArgs;
    readonly result: CredentialView;
  };
}

/**
 * Parses a credential's name: upper-case letters, digits and underscores, starting with a letter,
 * as an environment variable's name is written.
 */
const credentialNameSchema: z.ZodType<string> = z
  .string()
  .regex(/^[A-Z][A-Z0-9_]*$/)
  .max(credentialLimits.nameChars);

/**
 * Parses a host a credential may be sent to: a lower-case DNS name, matched exactly, with no
 * scheme, port, path or wildcard.
 */
const credentialHostSchema: z.ZodType<string> = z
  .string()
  .max(credentialLimits.hostChars)
  .regex(
    /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$/,
  );

const hosts = z.array(credentialHostSchema).max(credentialLimits.hosts).readonly();
const value = z
  .string()
  .min(1)
  .refine((text) => new TextEncoder().encode(text).byteLength <= credentialLimits.valueBytes, {
    message: "A credential is at most 64 KiB.",
  });
const agent = protocolIdSchema("agent");
const request = protocolIdSchema("credentialRequest");
const turnRef = z.object({
  session: protocolIdSchema("chatSession"),
  turn: protocolIdSchema("chatTurn"),
});

const credentialViewSchema: z.ZodType<CredentialView> = z.object({
  name: credentialNameSchema,
  allowedHosts: hosts,
  updatedAt: epochMsSchema,
});

/** Parses a {@link CredentialRequestView}. */
export const credentialRequestViewSchema: z.ZodType<CredentialRequestView> = z.object({
  request,
  agent,
  session: protocolIdSchema("chatSession"),
  turn: protocolIdSchema("chatTurn"),
  name: credentialNameSchema,
  reason: z.string().min(1).max(credentialLimits.reasonChars).exactOptional(),
  allowedHosts: hosts,
  updatedAt: epochMsSchema.exactOptional(),
  createdAt: epochMsSchema,
  closesAt: epochMsSchema,
});

// Every credential operation takes no idempotency key: a kept answer would store a credential's
// value, which never leaves the engine's store.
/** The credential operations, by name. */
export const credentialOperations: OperationTable<CredentialOperationShapes> = {
  "turn/credential": {
    ...readFlags,
    name: "turn/credential",
    scope: "agent",
    args: z.strictObject({
      agent,
      session: protocolIdSchema("chatSession"),
      turn: protocolIdSchema("chatTurn"),
      name: credentialNameSchema,
      reason: z.string().trim().min(1).max(credentialLimits.reasonChars).exactOptional(),
      allowedHosts: hosts.exactOptional(),
      timeoutSeconds: z.int().min(30).max(3_600).exactOptional(),
    }),
    result: credentialRequestViewSchema,
  },
  "credential/answer": {
    ...readFlags,
    name: "credential/answer",
    scope: "chat",
    args: z.strictObject({ agent, request, value, allowedHosts: hosts }),
    result: turnRef,
  },
  "credential/skip": {
    ...readFlags,
    name: "credential/skip",
    scope: "chat",
    args: z.strictObject({ agent, request }),
    result: turnRef,
  },
  "chat/openCredentialRequest": {
    ...readFlags,
    name: "chat/openCredentialRequest",
    scope: "read",
    args: z.strictObject({ agent }),
    result: z.object({ request: credentialRequestViewSchema.exactOptional() }),
  },
  "credential/list": {
    ...readFlags,
    name: "credential/list",
    scope: "read",
    args: z.strictObject({}),
    result: z.object({ items: z.array(credentialViewSchema).readonly() }),
  },
  "credential/delete": {
    ...readFlags,
    name: "credential/delete",
    // The agent and the owner both remove credentials; `propose` is the scope both carry.
    scope: "propose",
    args: z.strictObject({ name: credentialNameSchema }),
    result: z.object({ name: credentialNameSchema }),
  },
  "credential/set": {
    ...readFlags,
    name: "credential/set",
    scope: "admin",
    args: z.strictObject({
      name: credentialNameSchema,
      value,
      allowedHosts: hosts,
    }),
    result: credentialViewSchema,
  },
};
