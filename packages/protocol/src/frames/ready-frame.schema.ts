import { z } from "zod";
import { type Scope, scopeSchema } from "../auth/scopes.js";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Locale, localeSchema } from "../locale.js";

const engineStates = ["starting", "ready", "locked"] as const;

/**
 * Whether the engine serves calls yet. While `starting`, every operation except `engine/status`
 * fails with `engine.starting`, and a push on topic `engine` announces readiness. `locked`: the
 * engine serves every call but has no agent key, so it signs nothing until `engine/unlock`
 * opens it (decision 0103); a push on topic `engine` announces the unlock.
 */
export type EngineState = (typeof engineStates)[number];

/** Parses an engine state. */
export const engineStateSchema: z.ZodType<EngineState, string> = z.enum(engineStates);

/** The engine's side of `ready`. */
export interface EngineInfo {
  /** The engine's release. */
  readonly version: string;
  /** The newest protocol version the engine speaks. */
  readonly protocol: number;
  readonly state: EngineState;
}

/** The owner's settings that every surface follows. */
export interface OwnerInfo {
  readonly locale: Locale;
  /** An IANA zone, such as `Asia/Shanghai`. */
  readonly timezone: string;
}

/**
 * The engine's answer to a signed-in `open`. `v` is the protocol version of this connection, and
 * `scopes` bound every call on it.
 */
export interface ReadyFrame {
  readonly t: "ready";
  readonly v: number;
  readonly connection: ProtocolId<"connection">;
  readonly scopes: readonly Scope[];
  readonly engine: EngineInfo;
  readonly owner: OwnerInfo;
}

/** Parses a `ready` frame. */
export const readyFrameSchema: z.ZodType<ReadyFrame> = z.object({
  t: z.literal("ready"),
  v: z.int().positive(),
  connection: protocolIdSchema("connection"),
  scopes: z.array(scopeSchema),
  engine: z.object({
    version: z.string().min(1),
    protocol: z.int().positive(),
    state: engineStateSchema,
  }),
  owner: z.object({ locale: localeSchema, timezone: z.string().min(1) }),
});
