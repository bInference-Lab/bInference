import { type Id, idSchema } from "@binference/core";
import { z } from "zod";
import { fenceSchema, type Fenced } from "./fenced.js";

/** How a turn ended (runtime spec, section 4.1). */
export type TurnOutcome = "ok" | "stopped" | "failed" | "budget" | "loop";

/** One run of the agent's loop, under the id the engine reserved for it. */
export interface TurnRecord {
  readonly id: Id<"trn">;
  readonly sessionId: Id<"ses">;
  readonly startedAtMs: number;
  readonly endedAtMs?: number;
  readonly outcome?: TurnOutcome;
  /** A propose call's body started: the mark only goes from unset to set. */
  readonly committed: boolean;
  /** Its context held outside content: the mark only goes from unset to set. */
  readonly outsideContent: boolean;
  /** Propose calls it did not run, one proposal per turn (decision 0167). */
  readonly heldBack: number;
  /** The model the turn started on, as `<provider>/<model>`. */
  readonly model?: string;
}

/** A turn as it starts, once `turn/start` answered. */
export type TurnDraft = Pick<TurnRecord, "id" | "sessionId" | "startedAtMs" | "outsideContent"> & {
  readonly model?: string;
};

/** One turn, named for a mark or its end. */
export interface TurnRef {
  readonly turn: Id<"trn">;
}

/** A turn's end. */
export interface TurnEnd extends TurnRef {
  readonly atMs: number;
  readonly outcome: TurnOutcome;
  readonly heldBack: number;
}

const epochMs = z.int().nonnegative();
const outcomeSchema = z.enum(["ok", "stopped", "failed", "budget", "loop"]);
const modelSchema = z.string().min(1).max(200);

/** Parses a turn record. */
export const turnRecordSchema: z.ZodType<TurnRecord> = z.strictObject({
  id: idSchema("trn"),
  sessionId: idSchema("ses"),
  startedAtMs: epochMs,
  endedAtMs: epochMs.exactOptional(),
  outcome: outcomeSchema.exactOptional(),
  committed: z.boolean(),
  outsideContent: z.boolean(),
  heldBack: z.int().nonnegative(),
  model: modelSchema.exactOptional(),
});

/** Parses a fenced turn draft. */
export const turnDraftSchema: z.ZodType<Fenced<TurnDraft>> = z.strictObject({
  id: idSchema("trn"),
  sessionId: idSchema("ses"),
  startedAtMs: epochMs,
  outsideContent: z.boolean(),
  model: modelSchema.exactOptional(),
  fence: fenceSchema,
});

/** Parses a fenced turn reference. */
export const turnRefSchema: z.ZodType<Fenced<TurnRef>> = z.strictObject({
  turn: idSchema("trn"),
  fence: fenceSchema,
});

/** Parses a fenced turn end. */
export const turnEndSchema: z.ZodType<Fenced<TurnEnd>> = z.strictObject({
  turn: idSchema("trn"),
  atMs: epochMs,
  outcome: outcomeSchema,
  heldBack: z.int().nonnegative(),
  fence: fenceSchema,
});
