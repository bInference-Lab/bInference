import { maxUrlChars } from "@binference/core";
import { z } from "zod";
import { maxActionMs, maxWindowSide } from "../operations/browser-limits.js";

/** A key a click or a key press holds down with it. */
export type KeyModifier = "Alt" | "Control" | "Meta" | "Shift";

/** What every act takes: the most it may wait for its element, in milliseconds. */
interface ActBase {
  readonly timeoutMs?: number;
}

/** Clicks the element a snapshot named by its ref. */
interface ClickAct extends ActBase {
  readonly kind: "click";
  readonly ref: string;
  readonly doubleClick?: boolean;
  readonly button?: "left" | "right" | "middle";
  readonly modifiers?: readonly KeyModifier[];
}

/** Types text into an element, slowly key by key or at once, then presses Enter with `submit`. */
interface TypeAct extends ActBase {
  readonly kind: "type";
  readonly ref: string;
  readonly text: string;
  readonly submit?: boolean;
  readonly slowly?: boolean;
}

/** Presses a key or a chord such as `Control+A`, on an element or on the page. */
interface PressAct extends ActBase {
  readonly kind: "press";
  readonly key: string;
  readonly ref?: string;
}

/** Moves the pointer over an element. */
interface HoverAct extends ActBase {
  readonly kind: "hover";
  readonly ref: string;
}

/** Picks options of a select element by their values or labels. */
interface SelectAct extends ActBase {
  readonly kind: "select";
  readonly ref: string;
  readonly values: readonly string[];
}

/** One field of a form and the text it takes. */
export interface FilledField {
  readonly ref: string;
  readonly value: string;
}

/** Sets the text of form fields, each replacing what it held. */
interface FillAct extends ActBase {
  readonly kind: "fill";
  readonly fields: readonly FilledField[];
}

/** Scrolls an element into view. */
interface ScrollIntoViewAct extends ActBase {
  readonly kind: "scrollIntoView";
  readonly ref: string;
}

/** Drags one element onto another. */
interface DragAct extends ActBase {
  readonly kind: "drag";
  readonly startRef: string;
  readonly endRef: string;
}

/**
 * Waits for one thing: a time, text to show or go, an element by CSS selector, an address the
 * page reaches, or a load state.
 */
interface WaitAct extends ActBase {
  readonly kind: "wait";
  readonly timeMs?: number;
  readonly text?: string;
  readonly textGone?: string;
  readonly selector?: string;
  readonly url?: string;
  readonly loadState?: "load" | "domcontentloaded" | "networkidle";
}

/** Runs a script function in the page, given the element with `ref`, and answers its result. */
interface EvaluateAct extends ActBase {
  readonly kind: "evaluate";
  readonly fn: string;
  readonly ref?: string;
}

/** Sets the size of the page's window, in pixels. */
interface ResizeAct {
  readonly kind: "resize";
  readonly width: number;
  readonly height: number;
}

/** Closes the tab. */
interface CloseTabAct {
  readonly kind: "close";
}

/** One thing the agent does on a page (decision 0401). */
export type BrowserAct =
  | ClickAct
  | TypeAct
  | PressAct
  | HoverAct
  | SelectAct
  | FillAct
  | ScrollIntoViewAct
  | DragAct
  | WaitAct
  | EvaluateAct
  | ResizeAct
  | CloseTabAct;

/** A tab, by the id `tabs` names it with; the tab in focus when absent. */
interface OnTab {
  readonly tab?: string;
}

/**
 * One call of the agent's browser (decision 0401). Every action but `status` and `stop` starts
 * the browser when it is not running.
 */
export type BrowserRequest =
  | { readonly action: "status" }
  | { readonly action: "start" }
  | { readonly action: "stop" }
  | { readonly action: "tabs" }
  | { readonly action: "open"; readonly url: string }
  | { readonly action: "focus"; readonly tab: string }
  | ({ readonly action: "close" } & OnTab)
  | ({ readonly action: "navigate"; readonly url: string; readonly timeoutMs?: number } & OnTab)
  | ({
      readonly action: "snapshot";
      /** Only the elements a person acts on, and headings. */
      readonly interactive?: boolean;
      /** Only the lines holding every word of it, any case. */
      readonly query?: string;
    } & OnTab)
  | ({ readonly action: "screenshot"; readonly fullPage?: boolean; readonly ref?: string } & OnTab)
  | ({ readonly action: "text"; readonly selector?: string; readonly maxChars?: number } & OnTab)
  | ({ readonly action: "console"; readonly limit?: number } & OnTab)
  | ({ readonly action: "pdf" } & OnTab)
  | ({ readonly action: "act"; readonly act: BrowserAct } & OnTab);

// A snapshot's ref: `e12`, or `f2e7` for an element inside a frame.
const ref = z.string().regex(/^(?:f\d{1,4})?e\d{1,7}$/u);
const timeoutMs = z.int().min(1).max(maxActionMs).exactOptional();
const shortText = z.string().min(1).max(1_000);
const typed = z.string().max(10_000);
const tab = z.string().regex(/^t\d{1,6}$/u);
const url = z.string().trim().min(1).max(maxUrlChars);
const modifier = z.enum(["Alt", "Control", "Meta", "Shift"]);

/** Parses a {@link BrowserAct}. */
export const browserActSchema: z.ZodType<BrowserAct> = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("click"),
    ref,
    doubleClick: z.boolean().exactOptional(),
    button: z.enum(["left", "right", "middle"]).exactOptional(),
    modifiers: z.array(modifier).max(4).readonly().exactOptional(),
    timeoutMs,
  }),
  z.strictObject({
    kind: z.literal("type"),
    ref,
    text: typed,
    submit: z.boolean().exactOptional(),
    slowly: z.boolean().exactOptional(),
    timeoutMs,
  }),
  z.strictObject({
    kind: z.literal("press"),
    key: z.string().min(1).max(64),
    ref: ref.exactOptional(),
    timeoutMs,
  }),
  z.strictObject({ kind: z.literal("hover"), ref, timeoutMs }),
  z.strictObject({
    kind: z.literal("select"),
    ref,
    values: z.array(shortText).min(1).max(50).readonly(),
    timeoutMs,
  }),
  z.strictObject({
    kind: z.literal("fill"),
    fields: z
      .array(z.strictObject({ ref, value: typed }))
      .min(1)
      .max(50)
      .readonly(),
    timeoutMs,
  }),
  z.strictObject({ kind: z.literal("scrollIntoView"), ref, timeoutMs }),
  z.strictObject({ kind: z.literal("drag"), startRef: ref, endRef: ref, timeoutMs }),
  z.strictObject({
    kind: z.literal("wait"),
    timeMs: z.int().min(0).max(maxActionMs).exactOptional(),
    text: shortText.exactOptional(),
    textGone: shortText.exactOptional(),
    selector: shortText.exactOptional(),
    url: url.exactOptional(),
    loadState: z.enum(["load", "domcontentloaded", "networkidle"]).exactOptional(),
    timeoutMs,
  }),
  z.strictObject({
    kind: z.literal("evaluate"),
    fn: z.string().trim().min(1).max(20_000),
    ref: ref.exactOptional(),
    timeoutMs,
  }),
  z.strictObject({
    kind: z.literal("resize"),
    width: z.int().min(200).max(maxWindowSide),
    height: z.int().min(200).max(maxWindowSide),
  }),
  z.strictObject({ kind: z.literal("close") }),
]);

/** Parses a {@link BrowserRequest}. */
export const browserRequestSchema: z.ZodType<BrowserRequest> = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("status") }),
  z.strictObject({ action: z.literal("start") }),
  z.strictObject({ action: z.literal("stop") }),
  z.strictObject({ action: z.literal("tabs") }),
  z.strictObject({ action: z.literal("open"), url }),
  z.strictObject({ action: z.literal("focus"), tab }),
  z.strictObject({ action: z.literal("close"), tab: tab.exactOptional() }),
  z.strictObject({ action: z.literal("navigate"), url, timeoutMs, tab: tab.exactOptional() }),
  z.strictObject({
    action: z.literal("snapshot"),
    interactive: z.boolean().exactOptional(),
    query: z.string().trim().min(1).max(200).exactOptional(),
    tab: tab.exactOptional(),
  }),
  z.strictObject({
    action: z.literal("screenshot"),
    fullPage: z.boolean().exactOptional(),
    ref: ref.exactOptional(),
    tab: tab.exactOptional(),
  }),
  z.strictObject({
    action: z.literal("text"),
    selector: shortText.exactOptional(),
    maxChars: z.int().min(100).max(9_000).exactOptional(),
    tab: tab.exactOptional(),
  }),
  z.strictObject({
    action: z.literal("console"),
    limit: z.int().min(1).max(50).exactOptional(),
    tab: tab.exactOptional(),
  }),
  z.strictObject({ action: z.literal("pdf"), tab: tab.exactOptional() }),
  z.strictObject({ action: z.literal("act"), act: browserActSchema, tab: tab.exactOptional() }),
]);
