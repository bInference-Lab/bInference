import { z } from "zod";

/**
 * Every scope a protocol client can hold. The engine grants scopes per credential; a call above
 * the connection's scopes fails with `auth.scope`.
 */
export const scopes = ["read", "propose", "chat", "agent", "confirm", "loosen", "admin"] as const;

/** One thing a protocol client may do, such as `read` or `confirm`. */
export type Scope = (typeof scopes)[number];

/** Parses a scope. */
export const scopeSchema: z.ZodType<Scope, string> = z.enum(scopes);
