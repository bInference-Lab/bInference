import type { BinferenceConfig } from "../config/schema/config.schema.js";

const loopback = "127.0.0.1";

/** The HTTP listener the engine binds, and the owner's bot with the Mini App's address. */
interface PublishedParts<Bot> {
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly extraOrigins: readonly string[];
    readonly publicOrigin?: string;
  };
  readonly telegram?: Bot & { readonly miniAppUrl?: string };
}

/**
 * The engine's HTTP listener on loopback, and the owner's bot, as `remote.publicUrl` publishes the
 * engine's port: the HTTPS origin it names may open WebSockets and the console's files, never
 * pairing or health, and `/console` opens the Mini App at its `/mini`. Without it, nothing is
 * added.
 */
export function publishedParts<Bot extends object>(
  config: Pick<BinferenceConfig, "engine" | "remote">,
  bot: Bot | undefined,
): PublishedParts<Bot> {
  const { engine, remote } = config;
  const origin = remote.publicUrl === undefined ? undefined : new URL(remote.publicUrl).origin;
  const http = {
    host: loopback,
    port: engine.port,
    extraOrigins: engine.extraOrigins,
    ...(origin === undefined ? {} : { publicOrigin: origin }),
  };
  if (bot === undefined) {
    return { http };
  }
  return { http, telegram: origin === undefined ? bot : { ...bot, miniAppUrl: `${origin}/mini` } };
}
