import type { z } from "zod";

/**
 * The JSON object a Tailscale CLI command printed with `--json`, read from its first `{` to its
 * last `}`, since the CLI may print a warning line before it, and parsed by `schema`; `undefined`
 * when there is no such object or the schema refuses it.
 */
export function tailscaleJson<T>(stdout: string, schema: z.ZodType<T>): T | undefined {
  const start = stdout.indexOf("{");
  const end = stdout.lastIndexOf("}");
  if (start < 0 || end < start) {
    return undefined;
  }
  try {
    const parsed = schema.safeParse(JSON.parse(stdout.slice(start, end + 1)));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  }
}
