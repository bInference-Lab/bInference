import { carryGuards, type InstallGuards, installGuardsSchema } from "@binference/engine/backups";
import { z } from "zod";
import { defineTask, type StoreTask, type TaskRunner } from "../tasks/store-task.js";
import { readGuards } from "./guards-reads.js";
import { writeCarry } from "./guards-writes.js";

const epochMs = z.int().nonnegative();

/** Reads the guards of one `engine.sqlite` as they are at the input's time. */
export const readGuardsTask: StoreTask<number, InstallGuards> = defineTask({
  name: "restore.read_guards",
  access: "read",
  input: epochMs,
  output: installGuardsSchema,
  run: (database, nowMs) => readGuards(database, nowMs),
});

/** What a restore carries into the restored `engine.sqlite`: the replaced state's guards, and when. */
interface GuardsCarryInput {
  readonly current: InstallGuards;
  readonly nowMs: number;
}

const carryInputSchema: z.ZodType<GuardsCarryInput> = z.strictObject({
  current: installGuardsSchema,
  nowMs: epochMs,
});

/**
 * Writes into the restored `engine.sqlite` what the replaced state's guards carry (keys spec,
 * section 7.4), in one transaction: it reads the restored copy's own guards, merges the two as
 * `carryGuards` does, and writes the result. Answers the restored copy's guards as they are then.
 */
export const carryGuardsTask: StoreTask<GuardsCarryInput, InstallGuards> = defineTask({
  name: "restore.carry_guards",
  access: "write",
  input: carryInputSchema,
  output: installGuardsSchema,
  run(database, input) {
    const restored = readGuards(database, input.nowMs);
    writeCarry(database, carryGuards(input.current, restored, input.nowMs), input.nowMs);
    return readGuards(database, input.nowMs);
  },
});

/** Every task a restore runs on the two `engine.sqlite` files. */
export const installGuardsTasks: readonly TaskRunner[] = [readGuardsTask, carryGuardsTask];
