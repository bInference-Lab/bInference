import { z } from "zod";
import { type Scope, scopeSchema } from "../auth/scopes.js";

const operationKinds = ["read", "write", "subscribe"] as const;
const idempotencyRules = ["key", "none"] as const;
const transports = ["any", "ipc"] as const;
const responders = ["engine", "runtime"] as const;
const scopeConditions = ["looser", "autoMode", "fix", "ownIntent", "ownerNote"] as const;

/**
 * What a call of an operation does:
 * - `read` changes no stored state and needs no key;
 * - `write` changes stored state, needs an idempotency key and is durable before its reply;
 * - `subscribe` starts or stops pushes for this connection, which a client repeats after it
 *   reconnects.
 */
export type OperationKind = (typeof operationKinds)[number];

/**
 * What a call does with `key`. `key`: every call carries an idempotency key, and the same key with
 * the same args returns the stored result for 24 hours. `none`: the engine ignores a key.
 */
export type IdempotencyRule = (typeof idempotencyRules)[number];

/** Where a call is accepted: on both transports, or only over IPC, from a shell on the machine. */
export type OperationTransport = (typeof transports)[number];

/** Who answers a call: the engine, or the agent runtime through the engine. */
export type OperationResponder = (typeof responders)[number];

/**
 * When a call needs another scope than its operation's own:
 * - `looser`: a change makes a limit, send level or Binance Agent limit less safe;
 * - `autoMode`: the call turns auto mode on (`mode: "auto"`);
 * - `fix`: the call repairs what it finds (`fix: true`);
 * - `ownIntent`: the caller cancels an intent it proposed, before confirmation;
 * - `ownerNote`: the owner writes the note: the caller holds `admin` and not `agent`.
 */
export type ScopeCondition = (typeof scopeConditions)[number];

/**
 * A call that needs another scope than its operation's own. The engine decides the case from the
 * args, its state or the caller; a connection that holds neither scope fails with `auth.scope`.
 */
export interface ScopeCase {
  /** The scope such a call needs instead of the operation's own. */
  readonly scope: Scope;
  readonly when: ScopeCondition;
}

/** Parses an operation kind. */
export const operationKindSchema: z.ZodType<OperationKind, string> = z.enum(operationKinds);

/** Parses an idempotency rule. */
export const idempotencyRuleSchema: z.ZodType<IdempotencyRule, string> = z.enum(idempotencyRules);

/** Parses where a call is accepted. */
export const operationTransportSchema: z.ZodType<OperationTransport, string> = z.enum(transports);

/** Parses who answers a call. */
export const operationResponderSchema: z.ZodType<OperationResponder, string> = z.enum(responders);

/** Parses a scope case. */
export const scopeCaseSchema: z.ZodType<ScopeCase> = z.object({
  scope: scopeSchema,
  when: z.enum(scopeConditions),
});

/**
 * One protocol operation as data: its name, the one scope a call needs, its kind and idempotency
 * rule, where it is accepted, who answers, the engine release that added it, and the schemas of
 * its args and result. A typed client, the server and the MCP server are built from this.
 */
export interface Operation<Args = unknown, Result = unknown> {
  /** `domain/action`, such as `intent/propose`. */
  readonly name: string;
  readonly scope: Scope;
  readonly scopeCase?: ScopeCase;
  readonly kind: OperationKind;
  readonly idempotency: IdempotencyRule;
  readonly transport: OperationTransport;
  readonly answeredBy: OperationResponder;
  /** The engine release that added the operation, calver `YYYY.M.PATCH`. */
  readonly since: string;
  /** Parses the args; unknown fields are refused. */
  readonly args: z.ZodType<Args>;
  /** Parses the result; fields a newer engine adds are dropped. */
  readonly result: z.ZodType<Result>;
}

/** The args and result types of one operation. */
export interface OperationShape {
  readonly args: unknown;
  readonly result: unknown;
}

/**
 * A table of operations, by name, typed from an interface that maps each name to its
 * {@link OperationShape}.
 */
export type OperationTable<T extends Readonly<Record<keyof T, OperationShape>>> = {
  readonly [N in keyof T]: Operation<T[N]["args"], T[N]["result"]>;
};

/** The fields an operation's kind decides, shared by every operation of that kind. */
export interface OperationFlags {
  readonly kind: OperationKind;
  readonly idempotency: IdempotencyRule;
  readonly transport: OperationTransport;
  readonly answeredBy: OperationResponder;
  readonly since: string;
}

// No release exists before the first protocol version, so every operation of it is in every
// release a client meets.
const firstVersionSince = "2026.10.0";

/** The flags of a read the engine answers on both transports. */
export const readFlags: OperationFlags = {
  kind: "read",
  idempotency: "none",
  transport: "any",
  answeredBy: "engine",
  since: firstVersionSince,
};

/** The flags of a read the agent runtime answers through the engine. */
export const routedReadFlags: OperationFlags = { ...readFlags, answeredBy: "runtime" };

/** The flags of a write: it needs an idempotency key. */
export const writeFlags: OperationFlags = { ...readFlags, kind: "write", idempotency: "key" };

/** The flags of a write accepted only over IPC, so it needs a shell on the machine. */
export const localWriteFlags: OperationFlags = { ...writeFlags, transport: "ipc" };

/** The flags of a write the agent runtime answers through the engine. */
export const routedWriteFlags: OperationFlags = { ...writeFlags, answeredBy: "runtime" };

/** The flags of a call that starts or stops pushes for its connection. */
export const subscribeFlags: OperationFlags = { ...readFlags, kind: "subscribe" };
