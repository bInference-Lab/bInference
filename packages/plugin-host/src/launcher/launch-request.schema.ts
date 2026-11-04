import { z } from "zod";

/**
 * What the engine asks the plugin launcher: one plugin's id, never a path or a command line; to
 * start it, or with `removeData` to remove its data folder (decision 0351).
 */
export interface LaunchRequest {
  readonly plugin: string;
  readonly removeData?: true;
}

const launchRequestSchema: z.ZodType<LaunchRequest> = z.strictObject({
  plugin: z.string().regex(/^[a-z][a-z0-9-]{1,39}$/),
  removeData: z.literal(true).exactOptional(),
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
