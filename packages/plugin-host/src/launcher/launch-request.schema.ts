import { z } from "zod";

/** What the engine asks the plugin launcher: one plugin's id, never a command line. */
export interface LaunchRequest {
  readonly plugin: string;
}

const launchRequestSchema: z.ZodType<LaunchRequest> = z.strictObject({
  plugin: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
});

/** Reads the first line a connection to the launcher writes; none when it is not a request. */
export function parseLaunchRequest(line: string): LaunchRequest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return undefined;
  }
  const parsed = launchRequestSchema.safeParse(value);
  return parsed.success ? parsed.data : undefined;
}
