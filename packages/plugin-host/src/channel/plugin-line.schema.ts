import { nestsDeeperThan } from "@binference/core";
import { type PluginMessage, pluginMessageSchema } from "./channel-message.schema.js";

/**
 * Reads one line of a plugin's channel: its message, or none when it is not one. A line nested
 * past `maxJsonDepth` is none, read before any schema walks it (decision 0417).
 */
export function parsePluginLine(line: string): PluginMessage | undefined {
  if (nestsDeeperThan(line)) {
    return undefined;
  }
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = pluginMessageSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
