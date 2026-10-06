/** What the browser origins the HTTP listener accepts are built from. */
export interface OriginCheckOptions {
  /** The port the listener bound. */
  readonly port: number;
  /** Origins allowed besides the two loopback ones, such as the Tailscale serve origin. */
  readonly extraOrigins: readonly string[];
}

function originOf(text: string): string | undefined {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const { origin } = new URL(text);
  return origin === "null" ? undefined : origin;
}

/**
 * Builds the origin check of the HTTP listener: `http://127.0.0.1:<port>`,
 * `http://localhost:<port>` and the extra origins pass; a missing, opaque or other origin fails.
 * Origins compare after URL normalization, so case and a default port do not matter.
 */
export function createOriginCheck(
  options: OriginCheckOptions,
): (origin: string | undefined) => boolean {
  const allowed = new Set(
    [
      `http://127.0.0.1:${String(options.port)}`,
      `http://localhost:${String(options.port)}`,
      ...options.extraOrigins,
    ].flatMap((text) => originOf(text) ?? []),
  );
  return (origin) => {
    const normalized = origin === undefined ? undefined : originOf(origin);
    return normalized !== undefined && allowed.has(normalized);
  };
}
