import { type BrowserAct, browserLimits } from "@binference/protocol";
import type { Locator, Page } from "playwright-core";
import { z } from "zod";

/** What an act read: an `evaluate` act's result as JSON text. */
export interface ActDone {
  readonly value?: string;
}

type ActOf<K extends BrowserAct["kind"]> = Extract<BrowserAct, { readonly kind: K }>;

// How long an act waits for its element, and a wait for what it waits on, unless it names a time.
const actMs = 8_000;
const waitMs = 20_000;

function within(timeoutMs: number | undefined, fallback: number): number {
  return Math.min(timeoutMs ?? fallback, browserLimits.maxActionMs);
}

function byRef(page: Page, ref: string): Locator {
  return page.locator(`aria-ref=${ref}`);
}

// The page-side text that runs the agent's function on the element left under `key`, then
// answers its result as JSON text.
function evaluateSource(fn: string, key: string): string {
  const slot = JSON.stringify(key);
  return `(async () => { const target = window[${slot}]; delete window[${slot}]; const fn = (${fn}); const out = typeof fn === "function" ? await fn(target) : fn; return JSON.stringify(out) ?? "undefined"; })()`;
}

// Runs the agent's script as page text, which the page's own script rules never stop, on the
// element its ref names when it names one, and answers the result cut to fit.
async function evaluate(page: Page, act: ActOf<"evaluate">): Promise<ActDone> {
  const key = `__binferenceTarget${String(Date.now())}`;
  if (act.ref !== undefined) {
    const timeout = within(act.timeoutMs, actMs);
    await byRef(page, act.ref).evaluate(
      (element, slot) => {
        Reflect.set(globalThis, slot, element);
      },
      key,
      { timeout },
    );
  }
  const text = z.string().parse(await page.evaluate(evaluateSource(act.fn, key)));
  return { value: text.slice(0, browserLimits.maxValueChars) };
}

async function wait(page: Page, act: ActOf<"wait">): Promise<ActDone> {
  const timeout = within(act.timeoutMs, waitMs);
  if (act.timeMs !== undefined) {
    await page.waitForTimeout(Math.min(act.timeMs, browserLimits.maxActionMs));
  }
  if (act.text !== undefined) {
    await page.getByText(act.text).first().waitFor({ state: "visible", timeout });
  }
  if (act.textGone !== undefined) {
    await page.getByText(act.textGone).first().waitFor({ state: "hidden", timeout });
  }
  if (act.selector !== undefined) {
    await page.locator(act.selector).first().waitFor({ state: "visible", timeout });
  }
  if (act.url !== undefined) {
    await page.waitForURL(act.url, { timeout });
  }
  if (act.loadState !== undefined) {
    await page.waitForLoadState(act.loadState, { timeout });
  }
  return {};
}

async function click(page: Page, act: ActOf<"click">): Promise<void> {
  const options = {
    timeout: within(act.timeoutMs, actMs),
    ...(act.button === undefined ? {} : { button: act.button }),
    ...(act.modifiers === undefined ? {} : { modifiers: [...act.modifiers] }),
  };
  const target = byRef(page, act.ref);
  await (act.doubleClick === true ? target.dblclick(options) : target.click(options));
}

async function type(page: Page, act: ActOf<"type">): Promise<void> {
  const timeout = within(act.timeoutMs, actMs);
  const target = byRef(page, act.ref);
  await (act.slowly === true
    ? target.pressSequentially(act.text, { delay: 75, timeout })
    : target.fill(act.text, { timeout }));
  if (act.submit === true) {
    await target.press("Enter", { timeout });
  }
}

async function press(page: Page, act: ActOf<"press">): Promise<void> {
  const timeout = within(act.timeoutMs, actMs);
  await (act.ref === undefined
    ? page.keyboard.press(act.key)
    : byRef(page, act.ref).press(act.key, { timeout }));
}

async function fill(page: Page, act: ActOf<"fill">): Promise<void> {
  const timeout = within(act.timeoutMs, actMs);
  for (const field of act.fields) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- fields fill in order, as a person types them
    await byRef(page, field.ref).fill(field.value, { timeout });
  }
}

type PointerAct = ActOf<"hover" | "select" | "scrollIntoView" | "drag">;

async function pointer(page: Page, act: PointerAct): Promise<void> {
  const timeout = within(act.timeoutMs, actMs);
  if (act.kind === "hover") {
    await byRef(page, act.ref).hover({ timeout });
    return;
  }
  if (act.kind === "select") {
    await byRef(page, act.ref).selectOption([...act.values], { timeout });
    return;
  }
  if (act.kind === "scrollIntoView") {
    await byRef(page, act.ref).scrollIntoViewIfNeeded({ timeout });
    return;
  }
  await byRef(page, act.startRef).dragTo(byRef(page, act.endRef), { timeout });
}

type ElementAct = Exclude<BrowserAct, ActOf<"wait" | "evaluate" | "resize" | "close">>;

async function onElement(page: Page, act: ElementAct): Promise<void> {
  if (act.kind === "click") {
    return click(page, act);
  }
  if (act.kind === "type") {
    return type(page, act);
  }
  if (act.kind === "press") {
    return press(page, act);
  }
  return act.kind === "fill" ? fill(page, act) : pointer(page, act);
}

/**
 * Runs one act on a page, each on the element its snapshot ref names through Playwright's
 * `aria-ref` locator; Playwright's reason is thrown when it fails. Each waits for its element up
 * to its `timeoutMs`, 8 seconds unless it names one, a wait 20, never past 25.
 */
export async function runAct(page: Page, act: BrowserAct): Promise<ActDone> {
  if (act.kind === "evaluate") {
    return evaluate(page, act);
  }
  if (act.kind === "wait") {
    return wait(page, act);
  }
  if (act.kind === "resize") {
    await page.setViewportSize({ width: act.width, height: act.height });
  } else if (act.kind === "close") {
    await page.close();
  } else {
    await onElement(page, act);
  }
  return {};
}
