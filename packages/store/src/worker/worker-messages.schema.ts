import { isErrorCode, type ErrorCode, type ErrorDetails } from "@binference/core";
import { z } from "zod";

/** What a store worker receives as `workerData`: its role and its database file. */
export interface WorkerSetup {
  readonly role: "writer" | "reader";
  readonly file: string;
}

/** Checks `workerData` in a store worker. */
export const workerSetupSchema: z.ZodType<WorkerSetup> = z.strictObject({
  role: z.enum(["writer", "reader"]),
  file: z.string().min(1),
});

/** A value that crossed the thread boundary; the receiver parses it with its own schema. */
export type WorkerValue = unknown;

/** Runs one store task, by name, with its input. */
export interface TaskRequest {
  readonly id: number;
  readonly kind: "task";
  readonly task: string;
  readonly input: WorkerValue;
}

/** Asks the writer to apply pending migrations. */
export interface MigrateRequest {
  readonly id: number;
  readonly kind: "migrate";
}

/** Asks for an integrity report. */
export interface IntegrityRequest {
  readonly id: number;
  readonly kind: "integrity";
}

/** Asks for a `VACUUM INTO` copy at `target`. */
export interface VacuumRequest {
  readonly id: number;
  readonly kind: "vacuum";
  readonly target: string;
}

/** Asks the worker to close its connection and end. */
export interface CloseRequest {
  readonly id: number;
  readonly kind: "close";
}

/** Every message the main thread sends a store worker. */
export type WorkerRequest =
  | TaskRequest
  | MigrateRequest
  | IntegrityRequest
  | VacuumRequest
  | CloseRequest;

const id = z.number().int().nonnegative();

/** Checks a request in a store worker. */
export const workerRequestSchema: z.ZodType<WorkerRequest> = z.discriminatedUnion("kind", [
  z.strictObject({ id, kind: z.literal("task"), task: z.string().min(1), input: z.unknown() }),
  z.strictObject({ id, kind: z.literal("migrate") }),
  z.strictObject({ id, kind: z.literal("integrity") }),
  z.strictObject({ id, kind: z.literal("vacuum"), target: z.string().min(1) }),
  z.strictObject({ id, kind: z.literal("close") }),
]);

/** A fault, as it crosses from a worker: the parts of a `BinferenceError` that clone. */
export interface WorkerError {
  readonly code: ErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details: ErrorDetails;
}

const workerErrorSchema: z.ZodType<WorkerError> = z.strictObject({
  code: z.string().refine(isErrorCode),
  message: z.string(),
  retryable: z.boolean(),
  details: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])),
});

/** The worker opened its connection and serves requests. */
export interface ReadyMessage {
  readonly kind: "ready";
  readonly database: string;
  readonly schemaVersion: number;
  readonly latestVersion: number;
}

/** The worker could not open its database, closed what it opened, and ends. */
export interface RefusedMessage {
  readonly kind: "refused";
  readonly error: WorkerError;
}

/** The answer to one request. */
export type ReplyMessage =
  | { readonly kind: "reply"; readonly id: number; readonly ok: true; readonly value: WorkerValue }
  | {
      readonly kind: "reply";
      readonly id: number;
      readonly ok: false;
      readonly error: WorkerError;
    };

/** Every message a store worker sends the main thread. */
export type WorkerMessage = ReadyMessage | RefusedMessage | ReplyMessage;

const version = z.number().int().nonnegative();

/** Checks a message from a store worker on the main thread. */
export const workerMessageSchema: z.ZodType<WorkerMessage> = z.union([
  z.strictObject({
    kind: z.literal("ready"),
    database: z.string(),
    schemaVersion: version,
    latestVersion: version,
  }),
  z.strictObject({ kind: z.literal("refused"), error: workerErrorSchema }),
  z.strictObject({ kind: z.literal("reply"), id, ok: z.literal(true), value: z.unknown() }),
  z.strictObject({ kind: z.literal("reply"), id, ok: z.literal(false), error: workerErrorSchema }),
]);
