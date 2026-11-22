import { easedToward, progressOf, stepOf, type SceneMode } from "./progress";

/** What a registered scene asks of the loop. */
export interface SceneOptions {
  readonly mode: SceneMode;
  /** When above 0, the element's `data-step` follows the progress in this many steps. */
  readonly steps: number;
  readonly onProgress?: (p: number) => void;
}

interface Entry {
  readonly el: HTMLElement;
  readonly options: SceneOptions;
  target: number;
  now: number;
  fresh: boolean;
}

const entries = new Set<Entry>();
let running = false;
let listening = false;
const reduce = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

function measure(): void {
  const screen = innerHeight;
  for (const entry of entries) {
    entry.target = progressOf(entry.options.mode, entry.el.getBoundingClientRect(), screen);
  }
}

function paint(entry: Entry, p: number): void {
  entry.el.style.setProperty("--p", p.toFixed(4));
  if (entry.options.steps > 0) {
    entry.el.setAttribute("data-step", String(stepOf(p, entry.options.steps)));
  }
  entry.options.onProgress?.(p);
}

function frame(): void {
  let moving = false;
  const instant = reduce();
  for (const entry of entries) {
    const before = entry.now;
    entry.now = entry.fresh || instant ? entry.target : easedToward(entry.now, entry.target);
    moving ||= entry.now !== entry.target;
    if (entry.fresh || entry.now !== before) {
      paint(entry, entry.now);
    }
    entry.fresh = false;
  }
  running = moving;
  if (moving) {
    requestAnimationFrame(frame);
  }
}

function kick(): void {
  measure();
  if (!running) {
    running = true;
    requestAnimationFrame(frame);
  }
}

/**
 * Follows `el` through the page and writes its progress as `--p` (and `data-step`) on every
 * frame it moves. One scroll listener and one animation loop serve every scene. Returns the
 * function that stops following it.
 */
export function followScene(el: HTMLElement, options: SceneOptions): () => void {
  const entry: Entry = { el, options, target: 0, now: 0, fresh: true };
  entries.add(entry);
  if (!listening) {
    listening = true;
    addEventListener("scroll", kick, { passive: true });
    addEventListener("resize", kick, { passive: true });
  }
  kick();
  return () => {
    entries.delete(entry);
  };
}
