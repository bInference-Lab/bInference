import { createHash } from "node:crypto";
import { jsonValueSchema, stableJson } from "@binference/core";
import type { ToolCall } from "./model-message.js";

/** How many equal calls with equal results in one turn trip the guard (runtime spec, section 9). */
const loopRepeats = 3;

/** Watches one turn's tool calls for the same call giving the same result again and again. */
export interface LoopGuard {
  /**
   * Counts a call that ran and its result; answers whether this call is the third of the turn
   * with the same tool, the same arguments and the same result.
   */
  see(call: ToolCall, resultText: string): boolean;
}

const sha256 = (text: string): string => createHash("sha256").update(text, "utf8").digest("hex");

// The arguments as JSON with sorted keys, so two calls that wrote one object in another key order
// are the same call; arguments that are not JSON are compared as written.
function argumentsText(call: ToolCall): string {
  try {
    const parsed = jsonValueSchema.safeParse(JSON.parse(call.argumentsText));
    return parsed.success ? stableJson(parsed.data) : call.argumentsText;
  } catch {
    return call.argumentsText;
  }
}

/**
 * Creates a turn's loop guard (runtime spec, section 9): it compares each call by its tool's name,
 * the SHA-256 of its arguments as JSON with sorted keys and the SHA-256 of its result, and trips
 * on the third equal triple anywhere in the turn. Turned off (`models.loopDetection: false`), it
 * never trips.
 */
export function createLoopGuard(options: { readonly enabled: boolean }): LoopGuard {
  const seen = new Map<string, number>();
  return {
    see(call, resultText) {
      if (!options.enabled) {
        return false;
      }
      const key = `${call.name}\n${sha256(argumentsText(call))}\n${sha256(resultText)}`;
      const times = (seen.get(key) ?? 0) + 1;
      seen.set(key, times);
      return times >= loopRepeats;
    },
  };
}
