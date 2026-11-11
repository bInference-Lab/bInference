import { browserLimits, type ConsoleMessageView } from "@binference/protocol";
import {
  type BrowserContext,
  chromium,
  type Page,
  type Route,
  type WebSocketRoute,
} from "playwright-core";
import type { AddressGuard } from "./address-guard.js";
import type { BrowserProxy } from "./browser-proxy.js";

/** How one start of the browser runs: its program, its window, its profile and its proxy. */
export interface SessionLaunch {
  readonly executablePath: string;
  readonly headless: boolean;
  readonly userDataFolder: string;
  /** The owner's proxy; the browser goes direct when absent. */
  readonly proxy?: BrowserProxy;
}

/** A tab of the session: its id and its page. */
export interface SessionTab {
  readonly id: string;
  readonly page: Page;
}

/** One running browser: its tabs, the one in focus, and each tab's console messages. */
export interface BrowserSession {
  readonly headless: boolean;
  tabs(): readonly SessionTab[];
  /** The tab with the id, or the tab in focus without one. */
  tab(id?: string): SessionTab | undefined;
  focus(tab: SessionTab): void;
  /** Opens a new blank tab and focuses it. */
  open(): Promise<SessionTab>;
  consoleOf(page: Page): readonly ConsoleMessageView[];
  /** Whether the browser still runs: the owner may close its window. */
  isOpen(): boolean;
  close(): Promise<void>;
}

// Switches that keep the browser to its work: no first-run pages, sync, updates, translation or
// casting, no restore bubbles, and its own password store, never the OS keychain's prompts.
const switches = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-sync",
  "--disable-background-networking",
  "--disable-component-update",
  "--disable-features=Translate,MediaRouter",
  "--disable-session-crashed-bubble",
  "--hide-crash-restore-bubble",
  "--password-store=basic",
  "--use-mock-keychain",
  "--disable-dev-shm-usage",
] as const;

// How long the check of one request may take before the request is refused.
const checkMs = 5_000;
// The console messages each tab keeps, newest last.
const keptMessages = 200;

// A `file:` request gets the bytes the guard read through the handle it judged, so the browser
// never opens a path a link could move after the check (decision 0410).
async function servedFile(guard: AddressGuard, route: Route): Promise<void> {
  const page = await guard
    .readFile(route.request().url(), AbortSignal.timeout(checkMs))
    .catch(() => undefined);
  if (page === undefined) {
    await route.abort("blockedbyclient");
    return;
  }
  const type = page.contentType === undefined ? {} : { contentType: page.contentType };
  await route.fulfill({ status: 200, body: Buffer.from(page.bytes), ...type });
}

async function routed(guard: AddressGuard, route: Route): Promise<void> {
  if (route.request().url().startsWith("file:")) {
    await servedFile(guard, route);
    return;
  }
  const allowed = await guard
    .allows(route.request().url(), AbortSignal.timeout(checkMs))
    .catch(() => false);
  await (allowed ? route.continue() : route.abort("blockedbyclient"));
}

async function routedSocket(guard: AddressGuard, socket: WebSocketRoute): Promise<void> {
  const allowed = await guard.allows(socket.url(), AbortSignal.timeout(checkMs)).catch(() => false);
  if (allowed) {
    socket.connectToServer();
  } else {
    await socket.close({ code: 1008, reason: "refused" });
  }
}

function keep(messages: ConsoleMessageView[], message: ConsoleMessageView): void {
  messages.push({
    level: message.level,
    text: message.text.slice(0, browserLimits.maxConsoleTextChars),
  });
  messages.splice(0, Math.max(0, messages.length - keptMessages));
}

async function launched(launch: SessionLaunch, guard: AddressGuard): Promise<BrowserContext> {
  const context = await chromium.launchPersistentContext(launch.userDataFolder, {
    executablePath: launch.executablePath,
    headless: launch.headless,
    viewport: null,
    serviceWorkers: "block",
    acceptDownloads: false,
    args: launch.proxy === undefined ? [...switches, "--no-proxy-server"] : [...switches],
    ...(launch.proxy === undefined ? {} : { proxy: launch.proxy }),
  });
  await context.route("**/*", async (route) => routed(guard, route));
  await context.routeWebSocket(
    () => true,
    async (socket) => routedSocket(guard, socket),
  );
  return context;
}

/** The tabs of one context: an id and a console for each page, and the one in focus. */
interface TabTracking {
  readonly state: { focused: string; open: boolean };
  readonly tabs: () => readonly SessionTab[];
  readonly register: (page: Page) => SessionTab;
  readonly messages: WeakMap<Page, ConsoleMessageView[]>;
}

// Gives each page the context opens, a popup too, its id and its console, and focuses it.
function trackTabs(context: BrowserContext): TabTracking {
  const ids = new WeakMap<Page, string>();
  const messages = new WeakMap<Page, ConsoleMessageView[]>();
  const state = { next: 0, focused: "", open: true };
  const register = (page: Page): SessionTab => {
    state.next += 1;
    const id = `t${String(state.next)}`;
    const kept: ConsoleMessageView[] = [];
    ids.set(page, id);
    messages.set(page, kept);
    page.on("console", (message) => keep(kept, { level: message.type(), text: message.text() }));
    page.on("pageerror", (error) => keep(kept, { level: "pageerror", text: error.message }));
    state.focused = id;
    return { id, page };
  };
  context.pages().forEach(register);
  context.on("page", register);
  context.on("close", () => {
    state.open = false;
  });
  const tabs = (): readonly SessionTab[] =>
    context.pages().flatMap((page) => {
      const id = ids.get(page);
      return id === undefined ? [] : [{ id, page }];
    });
  return { state, tabs, register, messages };
}

/**
 * Starts the agent's browser (decision 0401): Playwright runs the program over a pipe, never a
 * debugging port, with the profile in `userDataFolder`, service workers blocked, and every request
 * and socket of every tab passed through `guard` first; a request it refuses never leaves.
 */
export async function openSession(
  launch: SessionLaunch,
  guard: AddressGuard,
): Promise<BrowserSession> {
  const context = await launched(launch, guard);
  const { state, tabs, register, messages } = trackTabs(context);
  return {
    headless: launch.headless,
    tabs,
    tab: (id) =>
      tabs().find((tab) => tab.id === (id ?? state.focused)) ??
      (id === undefined ? tabs().at(-1) : undefined),
    focus: (tab) => {
      state.focused = tab.id;
    },
    open: async () => {
      const page = await context.newPage();
      const found = tabs().find((tab) => tab.page === page) ?? register(page);
      state.focused = found.id;
      return found;
    },
    consoleOf: (page) => messages.get(page) ?? [],
    isOpen: () => state.open,
    close: async () => {
      state.open = false;
      await context.close();
    },
  };
}
