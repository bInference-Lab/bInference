import { type JsonValue, jsonValueSchema } from "@binference/core";
import {
  clientTokenSchema,
  isOperationName,
  type OperationName,
  operations,
  type ProtocolError,
  protocolErrorSchema,
} from "@binference/protocol";
import { z } from "zod";
import {
  type RuntimeSettings,
  type RuntimeSettingsWire,
  runtimeSettingsSchema,
} from "./runtime-settings.schema.js";

/**
 * Who a routed operation runs for, set by the engine from its caller: `untrusted` for the
 * runtime's own call in a turn that holds outside content, and for any other client with `agent`.
 */
export type RouteOrigin = "owner" | "agent" | "untrusted" | "system";

/** Where the runtime keeps its files. */
export interface RuntimePaths {
  /** `agent.sqlite`. */
  readonly agentDb: string;
  /** The folder of the agents' workspace files. */
  readonly workspace: string;
}

/** The first line the engine writes: the runtime's token for this start, and what it runs on. */
export interface StartLine {
  readonly t: "start";
  /** A secret: the client token the engine made for this start alone. */
  readonly token: string;
  /** The engine's IPC address: the socket path, or the pipe name on Windows. */
  readonly endpoint: string;
  readonly paths: RuntimePaths;
  readonly settings: RuntimeSettings;
}

/** The settings again, whole, after a reload changed a key the runtime uses. */
export interface SettingsLine {
  readonly t: "settings";
  readonly settings: RuntimeSettings;
}

/** A routed operation (runtime spec, section 10): its args as the operation's schema encodes them. */
export interface RouteLine {
  readonly t: "route";
  readonly id: string;
  readonly op: OperationName;
  readonly args: JsonValue;
  readonly origin: RouteOrigin;
}

/** The engine's shutdown order has begun. */
export interface StopLine {
  readonly t: "stop";
}

/** A line the engine writes to the runtime's standard input. */
export type EngineLine = StartLine | SettingsLine | RouteLine | StopLine;

/** The runtime opened its database and signed in to the engine. */
export interface ReadyLine {
  readonly t: "ready";
  readonly version: string;
  readonly schemaVersion: number;
}

/** The answer to one `route` line: its result as the operation's schema encodes it, or an error. */
export type RouteReplyLine =
  | { readonly t: "routeReply"; readonly id: string; readonly result: JsonValue }
  | { readonly t: "routeReply"; readonly id: string; readonly error: ProtocolError };

/** What the runtime is doing, every 10 seconds. */
export interface HealthLine {
  readonly t: "health";
  readonly runningTurns: number;
  readonly waitingMessages: number;
  /** The failure class of the latest model call that failed, such as `transient`. */
  readonly lastModelError?: string;
}

/** A line the runtime writes to its standard output. */
export type RuntimeLine = ReadyLine | RouteReplyLine | HealthLine;

type Wire<Line> = Line extends { readonly settings: RuntimeSettings }
  ? Omit<Line, "settings"> & { readonly settings: RuntimeSettingsWire }
  : Line extends RouteLine
    ? Omit<Line, "args"> & { readonly args: unknown }
    : Line;

/** An {@link EngineLine} as JSON carries it. */
export type EngineLineWire = Wire<EngineLine>;

const routeIdSchema = z.string().min(1).max(64);

/** The operations the runtime answers through the engine: those marked R in protocol spec 7. */
export function isRoutedOperation(op: string): op is OperationName {
  return isOperationName(op) && operations[op].answeredBy === "runtime";
}

const pathSchema = z.string().min(1).max(4_096);

/** Decodes an {@link EngineLine} from JSON, and encodes one back. */
export const engineLineSchema: z.ZodType<EngineLine, EngineLineWire> = z.discriminatedUnion("t", [
  z.strictObject({
    t: z.literal("start"),
    token: clientTokenSchema,
    endpoint: pathSchema,
    paths: z.strictObject({ agentDb: pathSchema, workspace: pathSchema }),
    settings: runtimeSettingsSchema,
  }),
  z.strictObject({ t: z.literal("settings"), settings: runtimeSettingsSchema }),
  z.strictObject({
    t: z.literal("route"),
    id: routeIdSchema,
    op: z.custom<OperationName>((op) => typeof op === "string" && isRoutedOperation(op)),
    args: jsonValueSchema,
    origin: z.enum(["owner", "agent", "untrusted", "system"]),
  }),
  z.strictObject({ t: z.literal("stop") }),
]);

const countSchema = z.int().nonnegative().max(1_000_000);

/** Decodes a {@link RuntimeLine} from JSON. */
export const runtimeLineSchema: z.ZodType<RuntimeLine> = z.union([
  z.strictObject({
    t: z.literal("ready"),
    version: z.string().min(1).max(64),
    schemaVersion: z.int().nonnegative(),
  }),
  z.strictObject({ t: z.literal("routeReply"), id: routeIdSchema, result: jsonValueSchema }),
  z.strictObject({ t: z.literal("routeReply"), id: routeIdSchema, error: protocolErrorSchema }),
  z.strictObject({
    t: z.literal("health"),
    runningTurns: countSchema,
    waitingMessages: countSchema,
    lastModelError: z.string().min(1).max(32).exactOptional(),
  }),
]);
