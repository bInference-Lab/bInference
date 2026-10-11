import type { BrowserPush } from "../push/browser-push";
import { readCardClick } from "../push/card-push.schema";

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
  /** The address's query, such as `?intent=int_…` from a card's notification. */
  readonly search: string;
  /** Browser push, where this browser has it; never in the Mini App (decision 0158). */
  readonly push?: BrowserPush;
  /**
   * Calls `open` with the intent of each card notification the owner clicks while this page is
   * open; answers the call that stops it.
   */
  readonly onCardClick: (open: (intent: string) => void) => () => void;
}

// The push worker lives at the root, so its scope is every page of the console.
const pushWorker = "/push-worker.js";

function pushOf(window: Window): BrowserPush | undefined {
  const { navigator, location } = window;
  const isMini = location.pathname === "/mini" || location.pathname.startsWith("/mini/");
  const hasPush =
    window.isSecureContext &&
    "serviceWorker" in navigator &&
    "PushManager" in window &&
    typeof Notification === "function";
  if (isMini || !hasPush) {
    return undefined;
  }
  return {
    permission: () => Notification.permission,
    requestPermission: async () => Notification.requestPermission(),
    manager: async () => {
      await navigator.serviceWorker.register(pushWorker, { scope: "/" });
      return (await navigator.serviceWorker.ready).pushManager;
    },
  };
}

function cardClicksOf(window: Window): ConsoleBrowser["onCardClick"] {
  return (open) => {
    const { navigator } = window;
    const workers = "serviceWorker" in navigator ? navigator.serviceWorker : undefined;
    const listener = (event: MessageEvent): void => {
      const intent = readCardClick(event.data);
      if (intent !== undefined) {
        open(intent);
      }
    };
    workers?.addEventListener("message", listener);
    return () => workers?.removeEventListener("message", listener);
  };
}

/** The console's view of the real browser window. */
export function browserOf(window: Window): ConsoleBrowser {
  const { location, navigator, history } = window;
  const push = pushOf(window);
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
    search: location.search,
    ...(push === undefined ? {} : { push }),
    onCardClick: cardClicksOf(window),
  };
}
