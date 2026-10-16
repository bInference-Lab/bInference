/** What the browser origins the HTTP listener accepts are built from. */
export interface OriginCheckOptions {
  /** The port the listener bound. */
  readonly port: number;
  /**
   * Origins allowed besides the two loopback ones, such as the Tailscale serve origin, read at each
   * check.
   */
  readonly extraOrigins: () => readonly string[];
  /**
   * The HTTPS origin a tunnel publishes the listener at (`remote.publicUrl`): it may open `/ws`,
   * the console's files and a Mini App's uploads, never `POST /pair` or `GET /health`.
   */
  readonly publicOrigin?: string;
}

/** Which origins and requests may reach each part of the HTTP listener. */
export interface OriginRules {
  /** Whether a WebSocket from this origin may sign in. */
  readonly isSocketOrigin: (origin: string | undefined) => boolean;
  /** Whether a `POST /pair` from this origin may pair a device. */
  readonly isPairingOrigin: (origin: string | undefined) => boolean;
  /** Whether this is the public origin, the only one a request through the public address may send. */
  readonly isPublicOrigin: (origin: string | undefined) => boolean;
  /**
   * Whether a request came through the public address: its `Host`, `X-Forwarded-Host` or
   * `Origin` names the public origin's host.
   */
  readonly isPublished: (headers: RequestNames) => boolean;
}

/** The rules before the listener binds: no origin may connect or pair, and nothing is published. */
export const closedOriginRules: OriginRules = {
  isSocketOrigin: () => false,
  isPairingOrigin: () => false,
  isPublicOrigin: () => false,
  isPublished: () => false,
};

/** The headers of a request that name where the browser or a proxy sent it. */
export interface RequestNames {
  readonly host?: string;
  readonly origin?: string;
  readonly forwardedHost?: string;
}

function originOf(text: string): string | undefined {
  if (!URL.canParse(text)) {
    return undefined;
  }
  const { origin } = new URL(text);
  return origin === "null" ? undefined : origin;
}

// The host name a `Host` header or an origin names, lowercase and without a port.
function hostNameOf(text: string | undefined): string | undefined {
  if (text === undefined || text === "") {
    return undefined;
  }
  const withScheme = text.includes("://") ? text : `http://${text}`;
  return URL.canParse(withScheme) ? new URL(withScheme).hostname : undefined;
}

function originSet(origins: () => readonly string[]): (origin: string | undefined) => boolean {
  return (origin) => {
    const allowed = new Set(origins().flatMap((text) => originOf(text) ?? []));
    const normalized = origin === undefined ? undefined : originOf(origin);
    return normalized !== undefined && allowed.has(normalized);
  };
}

/**
 * Builds the origin rules of the HTTP listener. `http://127.0.0.1:<port>`,
 * `http://localhost:<port>` and the extra origins open WebSockets and pair devices; the public
 * origin opens WebSockets and uploads only, and a request that names its host is kept from pairing
 * and health.
 * A missing, opaque or other origin fails. Origins compare after URL normalization, so case and a
 * default port do not matter. The extra origins are read at each check, so a connection or a
 * pairing after a change meets the new list; a socket already open stays.
 */
export function createOriginRules(options: OriginCheckOptions): OriginRules {
  const port = String(options.port);
  const loopback = [`http://127.0.0.1:${port}`, `http://localhost:${port}`];
  const local = (): readonly string[] => [...loopback, ...options.extraOrigins()];
  const { publicOrigin } = options;
  const published = publicOrigin === undefined ? undefined : hostNameOf(originOf(publicOrigin));
  const socketOrigins = publicOrigin === undefined ? local : () => [...local(), publicOrigin];
  return {
    isSocketOrigin: originSet(socketOrigins),
    isPairingOrigin: originSet(local),
    isPublicOrigin: originSet(() => (publicOrigin === undefined ? [] : [publicOrigin])),
    isPublished: (names) =>
      published !== undefined &&
      [names.host, names.forwardedHost, names.origin].some(
        (name) => hostNameOf(name) === published,
      ),
  };
}
