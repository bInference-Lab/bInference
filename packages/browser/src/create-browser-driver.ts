import { err, type Logger, ok, type Result } from "@binference/core";
import type { BrowserDriver, BrowserOutcome, BrowserRefusal } from "@binference/engine/browser";
import { type BrowserRequest, browserLimits } from "@binference/protocol";
import type { AddressGuard } from "./address-guard.js";
import { type ActionContext, listTabs, onTab, openTab, viewOf } from "./browser-actions.js";
import type { BrowserRoute } from "./browser-proxy.js";
import { type BrowserSession, openSession } from "./browser-session.js";

/** How the next start of the browser runs, as the owner's settings say now. */
export interface BrowserLaunch {
  /** The program `browser.executablePath` names; the one found on the machine when absent. */
  readonly executablePath?: string;
  readonly headless: boolean;
}

/** What the agent's browser is built from on this machine. */
export interface BrowserDriverOptions {
  readonly launch: () => BrowserLaunch;
  /** A Chrome-family browser installed on this machine, or `undefined`. */
  readonly findBrowser: () => string | undefined;
  /** The profile's folder, inside binference's state folder. */
  readonly userDataFolder: string;
  readonly route: () => BrowserRoute;
  readonly guard: AddressGuard;
  readonly logger: Logger;
}

type Ran = Result<BrowserOutcome, BrowserRefusal>;
type StartedRequest = Exclude<BrowserRequest, { readonly action: "status" | "stop" }>;

// Playwright's reason an action failed, without its call log or colours, cut to fit.
function problemOf(message: string): string {
  // oxlint-disable-next-line no-control-regex -- a terminal's colour codes in Playwright's reasons
  const plain = message.replace(/\u001b\[[0-9;]*m/gu, "").split("\nCall log:")[0] ?? "";
  return plain.trim().slice(0, browserLimits.maxProblemChars);
}

async function started(
  options: BrowserDriverOptions,
): Promise<Result<BrowserSession, BrowserRefusal>> {
  const route = options.route();
  if (route.kind === "held") {
    return err("proxy_held");
  }
  const launch = options.launch();
  const executablePath = launch.executablePath ?? options.findBrowser();
  if (executablePath === undefined) {
    return err("not_found");
  }
  const { userDataFolder } = options;
  const proxy = route.kind === "proxy" ? { proxy: route.proxy } : {};
  try {
    const session = await openSession(
      { executablePath, headless: launch.headless, userDataFolder, ...proxy },
      options.guard,
    );
    options.logger.info("browser.started");
    return ok(session);
  } catch {
    options.logger.warn("browser.start_failed", { errorCode: "browser.start_failed" });
    return err("start_failed");
  }
}

async function runStarted(context: ActionContext, request: StartedRequest): Promise<Ran> {
  if (request.action === "start") {
    return viewOf(context.session);
  }
  if (request.action === "tabs") {
    return listTabs(context);
  }
  return request.action === "open" ? openTab(context, request.url) : onTab(context, request);
}

// An action that throws ran and failed: its answer names why, with the tab as it is now.
async function guarded(context: ActionContext, request: StartedRequest): Promise<Ran> {
  try {
    return await runStarted(context, request);
  } catch (error) {
    const message = error instanceof Error ? error.message : "The action failed.";
    if (!context.session.isOpen()) {
      return ok({ view: { running: false, problem: problemOf(message) } });
    }
    return viewOf(context.session, { problem: problemOf(message) }).catch(() =>
      ok({ view: { running: true, problem: problemOf(message) } }),
    );
  }
}

/**
 * The agent's browser on this machine (decision 0401): binference's own Chrome-family browser,
 * the program `browser.executablePath` names or the one found here, with its profile in
 * `userDataFolder`, through the owner's proxy, every request passed through the address check.
 * Calls run one at a time; every action but `status` and `stop` starts the browser when it does
 * not run, as the settings and the proxy say then.
 */
export function createBrowserDriver(options: BrowserDriverOptions): BrowserDriver {
  const held: { session?: BrowserSession; line: Promise<void> } = { line: Promise.resolve() };
  const isRunning = (): boolean => held.session?.isOpen() === true;
  const stop = async (): Promise<void> => {
    const { session } = held;
    delete held.session;
    await session?.close().catch(() => undefined);
  };
  const run = async (request: BrowserRequest, signal: AbortSignal): Promise<Ran> => {
    if (request.action === "stop") {
      await stop();
    }
    if (request.action === "status" || request.action === "stop") {
      return isRunning() && held.session !== undefined
        ? viewOf(held.session)
        : ok({ view: { running: false } });
    }
    if (!isRunning()) {
      await stop();
      const opened = await started(options);
      if (!opened.ok) {
        return opened;
      }
      held.session = opened.value;
    }
    const session = held.session;
    return session === undefined
      ? err("start_failed")
      : guarded({ session, guard: options.guard, signal }, request);
  };
  return {
    run: async (request, { signal }) => {
      const turn = held.line.then(async () => run(request, signal));
      held.line = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    stop: async () => {
      const turn = held.line.then(stop);
      held.line = turn.then(
        () => undefined,
        () => undefined,
      );
      return turn;
    },
    isRunning,
  };
}
