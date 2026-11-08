import { err, ok, type Result } from "@binference/core";
import type { BrowserAct, BrowserRequest, BrowserTabView } from "@binference/protocol";
import type { BrowserOutcome, BrowserRefusal } from "../browse/browser-records.js";
import type { BrowserDriver } from "../browse/ports.js";

/** A page the fake browser opens: its title, its prose, and the title a press of its button sets. */
export interface FakePage {
  readonly title: string;
  readonly text: string;
  readonly clickedTitle?: string;
  /** The selectors an element of the page matches, besides its article, main and body. */
  readonly selectors?: readonly string[];
}

/** A fake browser driver, which keeps every request it took. */
export interface FakeBrowserDriver extends BrowserDriver {
  readonly requests: readonly BrowserRequest[];
}

/** The pages the fake opens by their addresses, the addresses it refuses, and a missing browser. */
export interface FakeBrowserOptions {
  readonly pages: Readonly<Record<string, FakePage>>;
  readonly refused?: readonly string[];
  /** Whether no browser is found: every action that starts it is `not_found`. */
  readonly missing?: boolean;
}

/** The fake's tabs, kept in a closure: each change goes through a method. */
interface FakeTabs {
  readonly running: () => boolean;
  readonly start: () => void;
  readonly clear: () => void;
  readonly open: (url: string, title: string) => void;
  readonly find: (id: string | undefined) => BrowserTabView | undefined;
  readonly set: (tab: BrowserTabView) => void;
  readonly close: (id: string) => void;
  readonly focused: () => BrowserTabView | undefined;
  readonly list: () => readonly BrowserTabView[];
}

/** What every action of the fake reads. */
interface FakeContext {
  readonly options: FakeBrowserOptions;
  readonly tabs: FakeTabs;
}

type Ran = Result<BrowserOutcome, BrowserRefusal>;

const blank: FakePage = { title: "", text: "" };
const proseParts: ReadonlySet<string> = new Set(["article", "main", "body"]);
const pngBytes = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0);
const pdfBytes = new TextEncoder().encode("%PDF-1.7\n%%EOF\n");

function createFakeTabs(): FakeTabs {
  const tabs = new Map<string, BrowserTabView>();
  const state = { running: false, next: 0, focused: "" };
  return {
    running: () => state.running,
    start: () => {
      state.running = true;
    },
    clear: () => {
      Object.assign(state, { running: false, focused: "" });
      tabs.clear();
    },
    open: (url, title) => {
      state.next += 1;
      const tab = `t${String(state.next)}`;
      tabs.set(tab, { tab, url, title });
      state.focused = tab;
    },
    find: (id) => tabs.get(id ?? state.focused),
    set: (tab) => {
      tabs.set(tab.tab, tab);
      state.focused = tab.tab;
    },
    close: (id) => {
      tabs.delete(id);
      state.focused = [...tabs.keys()].at(-1) ?? "";
    },
    focused: () => tabs.get(state.focused),
    list: () => [...tabs.values()],
  };
}

function answer(context: FakeContext, more: Omit<BrowserOutcome["view"], "running"> = {}): Ran {
  const focused = context.tabs.focused();
  const tab = focused === undefined ? {} : { tab: focused };
  return ok({ view: { running: context.tabs.running(), ...tab, ...more } });
}

function pageOf(context: FakeContext, tab: BrowserTabView): FakePage {
  return context.options.pages[tab.url] ?? blank;
}

function snapshotOf(page: FakePage): string {
  return `- heading "${page.title}" [level=1] [ref=e1]\n- button "Press" [ref=e2]`;
}

function captured(context: FakeContext, capture: NonNullable<BrowserOutcome["capture"]>): Ran {
  const answered = answer(context);
  return answered.ok ? ok({ ...answered.value, capture }) : answered;
}

type ActRun = (context: FakeContext, tab: BrowserTabView, act: BrowserAct) => Ran;

const acted: ActRun = (context) => answer(context);

const acts: Readonly<Record<BrowserAct["kind"], ActRun>> = {
  click: (context, tab, act) => {
    if (!("ref" in act) || act.ref !== "e2") {
      const ref = "ref" in act ? act.ref : "";
      return answer(context, { problem: `No element has ref ${ref}: take a new snapshot.` });
    }
    const page = pageOf(context, tab);
    context.tabs.set({ ...tab, title: page.clickedTitle ?? page.title });
    return answer(context);
  },
  evaluate: (context, tab) => answer(context, { value: JSON.stringify(tab.title) }),
  close: (context, tab) => {
    context.tabs.close(tab.tab);
    return answer(context, { tabs: context.tabs.list() });
  },
  type: acted,
  press: acted,
  hover: acted,
  select: acted,
  fill: acted,
  scrollIntoView: acted,
  drag: acted,
  wait: acted,
  resize: acted,
};

type TabRun = (context: FakeContext, tab: BrowserTabView, request: BrowserRequest) => Ran;

const onTab: Readonly<Record<string, TabRun>> = {
  navigate: (context, tab, request) => {
    const url = "url" in request ? request.url : tab.url;
    if (context.options.refused?.includes(url) === true) {
      return err("address_refused");
    }
    const page = context.options.pages[url] ?? blank;
    context.tabs.set({ ...tab, url, title: page.title });
    return answer(context, { snapshot: snapshotOf(page) });
  },
  snapshot: (context, tab) => answer(context, { snapshot: snapshotOf(pageOf(context, tab)) }),
  text: (context, tab, request) => {
    const page = pageOf(context, tab);
    const selector = request.action === "text" ? request.selector : undefined;
    const matched =
      selector === undefined || proseParts.has(selector) || page.selectors?.includes(selector);
    return matched === true
      ? answer(context, { text: page.text })
      : answer(context, { problem: `No element matches ${selector ?? ""}.` });
  },
  console: (context) => answer(context, { console: [] }),
  screenshot: (context) => captured(context, { bytes: pngBytes, contentType: "image/png" }),
  pdf: (context) => captured(context, { bytes: pdfBytes, contentType: "application/pdf" }),
  act: (context, tab, request) =>
    "act" in request ? acts[request.act.kind](context, tab, request.act) : answer(context),
  focus: (context) => answer(context, { tabs: context.tabs.list() }),
  close: (context, tab) => {
    context.tabs.close(tab.tab);
    return answer(context, { tabs: context.tabs.list() });
  },
};

function openTab(context: FakeContext, url: string): Ran {
  if (context.options.refused?.includes(url) === true) {
    return err("address_refused");
  }
  context.tabs.open(url, context.options.pages[url]?.title ?? "");
  return answer(context, { tabs: context.tabs.list() });
}

function runStarted(context: FakeContext, request: BrowserRequest): Ran {
  if (!context.tabs.running()) {
    context.tabs.start();
    context.tabs.open("about:blank", "");
  }
  if (request.action === "start") {
    return answer(context, { headless: true });
  }
  if (request.action === "tabs" || request.action === "open") {
    return "url" in request
      ? openTab(context, request.url)
      : answer(context, { tabs: context.tabs.list() });
  }
  const tab = context.tabs.find("tab" in request ? request.tab : undefined);
  const run = onTab[request.action];
  if (tab === undefined || run === undefined) {
    return err("tab_not_found");
  }
  context.tabs.set(tab);
  return run(context, tab, request);
}

/**
 * A browser driver in memory, for tests: it opens the pages it is given, refuses the addresses it
 * is told to, and answers each page's snapshot with one heading and one button, ref `e2`, whose
 * press sets the page's `clickedTitle`. Screenshots and PDFs are a few bytes of their format.
 */
export function createFakeBrowserDriver(options: FakeBrowserOptions): FakeBrowserDriver {
  const requests: BrowserRequest[] = [];
  const context: FakeContext = { options, tabs: createFakeTabs() };
  const run = (request: BrowserRequest): Ran => {
    requests.push(request);
    if (request.action === "stop") {
      context.tabs.clear();
    }
    if (request.action === "status" || request.action === "stop") {
      return answer(context);
    }
    return options.missing === true ? err("not_found") : runStarted(context, request);
  };
  return {
    requests,
    run: async (request) => Promise.resolve(run(request)),
    stop: async () => {
      context.tabs.clear();
      return Promise.resolve();
    },
    isRunning: () => context.tabs.running(),
  };
}
