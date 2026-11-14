import type { OperationName } from "@binference/protocol";

/**
 * Why the engine `binference start` runs answers no call of an operation: it is not built yet, the
 * CLI does the work itself without the engine, or another operation took its place.
 */
export type UnservedReason =
  | { readonly kind: "not_built" }
  | { readonly kind: "in_cli" }
  | { readonly kind: "replaced"; readonly by: OperationName };

const notBuilt: UnservedReason = { kind: "not_built" };

const unserved: readonly (readonly [OperationName, UnservedReason])[] = [
  ["agent/archive", notBuilt],
  ["agent/create", notBuilt],
  ["agent/rename", notBuilt],
  // Decision 0152: the restore needs the owner key from start to end, so the CLI runs it.
  ["backup/restore", { kind: "in_cli" }],
  ["binanceAgent/connect", notBuilt],
  ["binanceAgent/list", notBuilt],
  ["binanceAgent/pause", notBuilt],
  ["binanceAgent/record", notBuilt],
  ["binanceAgent/report", notBuilt],
  ["binanceAgent/resume", notBuilt],
  ["binanceAgent/setLimits", notBuilt],
  ["binanceAgent/stop", notBuilt],
  ["binanceAgent/timeline", notBuilt],
  ["cex/connect", notBuilt],
  ["cex/disconnect", notBuilt],
  ["cex/status", notBuilt],
  ["config/read", notBuilt],
  ["intent/cancel", notBuilt],
  ["ledger/export", notBuilt],
  ["log/follow", notBuilt],
  ["log/unfollow", notBuilt],
  // Decision 0263: the support bundle is written while the engine is stopped too.
  ["report/create", { kind: "in_cli" }],
  // Decision 0154: no token secret may reach the idempotency store, so only its hash is sent.
  ["token/create", { kind: "replaced", by: "token/register" }],
  // Decision 0131: a key leaves custody only sealed.
  ["wallet/exportKey", { kind: "replaced", by: "wallet/exportSealed" }],
  ["wallet/rename", notBuilt],
];

/**
 * The protocol operations the self-hosted engine leaves unserved, by name, each with why. A call
 * of one fails `protocol.unknown_op`. The CLI's served-operations test holds the engine and every
 * surface to this list, and the operations reference shows it, so a new operation is served in the
 * change that adds it or named here.
 */
export const unservedOperations: ReadonlyMap<string, UnservedReason> = new Map(unserved);

/**
 * Why a Cloud root leaves unserved an operation the self-hosted engine serves: it reads the machine
 * the engine runs on, such as its log file or its checks, and an install on bInference Cloud has
 * none of its own.
 */
export interface CloudUnservedReason {
  readonly kind: "own_machine";
}

const ownMachine: CloudUnservedReason = { kind: "own_machine" };

const cloudUnserved: readonly (readonly [OperationName, CloudUnservedReason])[] = [
  ["check/run", ownMachine],
  ["log/recent", ownMachine],
];

/**
 * The operations the self-hosted engine serves and a Cloud root leaves unserved, by name, each with
 * why (decisions 0445 and 0446). The operations reference marks each as answered on a self-hosted install
 * only, and the served-operations test holds the self-hosted engine to serving each.
 */
export const cloudUnservedOperations: ReadonlyMap<string, CloudUnservedReason> = new Map(
  cloudUnserved,
);
