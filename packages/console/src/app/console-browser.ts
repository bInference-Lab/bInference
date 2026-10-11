/** Sends one request to the page's own origin, as the browser's `fetch` does. */
export type Fetcher = (path: string, init: RequestInit) => Promise<Response>;

/** What the console takes from the browser, so tests can hand it their own. */
export interface ConsoleBrowser {
  /** The page's origin, such as `http://127.0.0.1:7456`, which a device signs. */
  readonly origin: string;
  /** `host:port`, where the WebSocket connects. */
  readonly host: string;
  /** Whether the page came over HTTPS, as through Tailscale serve, so the socket is `wss`. */
  readonly isSecure: boolean;
  readonly pathname: string;
  /** The address's hash now, such as `#pair=<code>`. */
  readonly readHash: () => string;
  /** Takes the hash out of the address bar and the history, so a pairing link is not kept. */
  readonly clearHash: () => void;
  /** WebCrypto, which only a secure context such as `127.0.0.1` has. */
  readonly subtle: SubtleCrypto | undefined;
  readonly indexedDB: IDBFactory | undefined;
  readonly fetch: Fetcher;
  readonly openSocket: (url: string) => WebSocket;
  /** The device's platform, such as `macOS`, for the device's label. */
  readonly platform: string;
  /** The browser's language, such as `zh-CN`, until the engine names the owner's. */
  readonly language: string;
}

/** The console's view of the real browser window. */
export function browserOf(window: Window): ConsoleBrowser {
  const { location, navigator, history } = window;
  return {
    origin: location.origin,
    host: location.host,
    isSecure: location.protocol === "https:",
    pathname: location.pathname,
    readHash: () => location.hash,
    clearHash: () => history.replaceState(null, "", location.pathname + location.search),
    subtle: window.isSecureContext ? window.crypto.subtle : undefined,
    indexedDB: window.indexedDB,
    fetch: async (path, init) => window.fetch(path, init),
    openSocket: (url) => new WebSocket(url),
    platform: navigator.platform === "" ? "web" : navigator.platform,
    language: navigator.language,
  };
}
