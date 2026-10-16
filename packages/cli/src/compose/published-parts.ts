import type { BinferenceConfig } from "../config/schema/config.schema.js";

const loopback = "127.0.0.1";

/** The HTTP listener the engine binds, and the owner's bot with the Mini App's address. */
interface PublishedParts<Bot> {
  readonly http: {
    readonly host: string;
    readonly port: number;
    readonly extraOrigins: () => readonly string[];
    readonly publicOrigin?: string;
  };
  readonly telegram?: Bot & { readonly miniAppUrl?: string };
}

/**
 * The engine's HTTP listener on loopback, and the owner's bot, as `remote.publicUrl` publishes the
 * engine's port: the HTTPS origin it names may open WebSockets and the console's files, never
 * pairing or health, and `/console` opens the Mini App at its `/mini`. Without it, nothing is
 * added. The port and the public address are those the engine started with; the extra origins
 * come as the config cell holds them at each check.
 */
export function publishedParts<Bot extends object>(
  settings: {
    readonly started: Pick<BinferenceConfig, "engine" | "remote">;
    current(): { readonly engine: { readonly extraOrigins: readonly string[] } };
  },
  bot: Bot | undefined,
): PublishedParts<Bot> {
  const { engine, remote } = settings.started;
  const origin = remote.publicUrl === undefined ? undefined : new URL(remote.publicUrl).origin;
  const http = {
    host: loopback,
    port: engine.port,
    extraOrigins: () => settings.current().engine.extraOrigins,
    ...(origin === undefined ? {} : { publicOrigin: origin }),
  };
  if (bot === undefined) {
    return { http };
  }
  return { http, telegram: origin === undefined ? bot : { ...bot, miniAppUrl: `${origin}/mini` } };
}
