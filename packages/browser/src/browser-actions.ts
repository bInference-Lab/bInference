import { err, ok, type Result } from "@binference/core";
import type { BrowserOutcome, BrowserRefusal } from "@binference/engine/browser";
import { type BrowserRequest, type BrowserTabView, browserLimits } from "@binference/protocol";
import type { AddressGuard } from "./address-guard.js";
import type { BrowserSession, SessionTab } from "./browser-session.js";
import { runAct } from "./page-acts.js";
import { pageText, pdfOf, screenshotOf } from "./page-reads.js";
import { snapshotOf } from "./page-snapshot.js";

/** What every action runs on: the running browser and the check of addresses. */
export interface ActionContext {
  readonly session: BrowserSession;
  readonly guard: AddressGuard;
  readonly signal: AbortSignal;
}

type Ran = Result<BrowserOutcome, BrowserRefusal>;
type TabRequest = Exclude<
  BrowserRequest,
  { readonly action: "status" | "stop" | "start" | "tabs" | "open" }
>;

// How long a page has to load, and a read to answer, unless the call names a time; a navigation
// keeps time for its snapshot inside the engine's 30 seconds.
const navigateMs = 20_000;
const readMs = 10_000;
const afterNavigateMs = 4_000;

async function tabView(tab: SessionTab): Promise<BrowserTabView> {
  const title = await tab.page.title().catch(() => "");
  return { tab: tab.id, url: tab.page.url().slice(0, 8_192), title: title.slice(0, 1_000) };
}

async function tabsOf(session: BrowserSession): Promise<readonly BrowserTabView[]> {
  const tabs = session.tabs().slice(-browserLimits.maxTabs);
  return Promise.all(tabs.map(tabView));
}

/** The view every answer starts from: the browser runs, with the tab in focus as it is now. */
export async function viewOf(
  session: BrowserSession,
  more: Omit<BrowserOutcome["view"], "running"> = {},
): Promise<Ran> {
  const tab = session.tab();
  const focused = tab === undefined || tab.page.isClosed() ? {} : { tab: await tabView(tab) };
  return ok({ view: { running: true, headless: session.headless, ...focused, ...more } });
}

/** The tabs, for `tabs`. */
export async function listTabs(context: ActionContext): Promise<Ran> {
  return viewOf(context.session, { tabs: await tabsOf(context.session) });
}

/** Opens a tab at an address the check allows, and focuses it. */
export async function openTab(context: ActionContext, url: string): Promise<Ran> {
  if (!(await context.guard.allows(url, context.signal))) {
    return err("address_refused");
  }
  const tab = await context.session.open();
  await tab.page.goto(url, { timeout: navigateMs, waitUntil: "domcontentloaded" });
  return listTabs(context);
}

async function navigate(
  context: ActionContext,
  tab: SessionTab,
  request: Extract<TabRequest, { readonly action: "navigate" }>,
): Promise<Ran> {
  if (!(await context.guard.allows(request.url, context.signal))) {
    return err("address_refused");
  }
  const timeout = Math.min(
    request.timeoutMs ?? navigateMs,
    browserLimits.maxActionMs - afterNavigateMs,
  );
  await tab.page.goto(request.url, { timeout, waitUntil: "domcontentloaded" });
  const seen = await snapshotOf(tab.page, { interactive: true, timeoutMs: afterNavigateMs });
  return viewOf(context.session, { snapshot: seen.snapshot, cut: seen.cut });
}

async function closeTab(context: ActionContext, tab: SessionTab): Promise<Ran> {
  await tab.page.close();
  return listTabs(context);
}

async function readTab(context: ActionContext, tab: SessionTab, request: TabRequest): Promise<Ran> {
  const { session } = context;
  const { page } = tab;
  if (request.action === "snapshot") {
    const seen = await snapshotOf(page, { ...request, timeoutMs: readMs });
    return viewOf(session, { snapshot: seen.snapshot, cut: seen.cut });
  }
  if (request.action === "text") {
    const read = await pageText(page, { ...request, timeoutMs: readMs });
    return viewOf(session, read);
  }
  if (request.action === "console") {
    const limit = request.limit ?? browserLimits.maxConsoleMessages;
    return viewOf(session, { console: session.consoleOf(page).slice(-limit) });
  }
  const capture =
    request.action === "pdf"
      ? await pdfOf(page)
      : await screenshotOf(page, { ...("fullPage" in request ? request : {}), timeoutMs: readMs });
  const viewed = await viewOf(session);
  return viewed.ok ? ok({ ...viewed.value, capture }) : viewed;
}

/** Runs an action on a tab: the one it names, or the one in focus, which it focuses. */
export async function onTab(context: ActionContext, request: TabRequest): Promise<Ran> {
  const tab = context.session.tab("tab" in request ? request.tab : undefined);
  if (tab === undefined) {
    return err("tab_not_found");
  }
  context.session.focus(tab);
  if (request.action === "focus") {
    await tab.page.bringToFront();
    return listTabs(context);
  }
  if (request.action === "close") {
    return closeTab(context, tab);
  }
  if (request.action === "navigate") {
    return navigate(context, tab, request);
  }
  if (request.action === "act") {
    const done = await runAct(tab.page, request.act);
    return request.act.kind === "close" ? listTabs(context) : viewOf(context.session, done);
  }
  return readTab(context, tab, request);
}
