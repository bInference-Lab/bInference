import { browserLimits } from "@binference/protocol";
import type { Page } from "playwright-core";

/** Which lines of a snapshot to keep: only the elements a person acts on, and lines with words. */
export interface SnapshotFilter {
  readonly interactive?: boolean;
  readonly query?: string;
}

/** A snapshot cut to fit, and whether anything was cut. */
export interface PageSnapshot {
  readonly snapshot: string;
  readonly cut: boolean;
}

// The roles of the elements a person acts on, and the headings that tell where they are.
const actedRoles = new Set([
  "button",
  "checkbox",
  "combobox",
  "heading",
  "link",
  "listbox",
  "menuitem",
  "menuitemcheckbox",
  "menuitemradio",
  "option",
  "radio",
  "searchbox",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
  "treeitem",
]);

// The role a snapshot line names, as in `  - button "Go" [ref=e3]`.
function roleOf(line: string): string {
  return /^\s*- ([a-z]+)/u.exec(line)?.[1] ?? "";
}

function keeps(filter: SnapshotFilter): (line: string) => boolean {
  const words = (filter.query ?? "")
    .toLowerCase()
    .split(/\s+/u)
    .filter((word) => word !== "");
  return (line) => {
    const acted =
      filter.interactive !== true || (line.includes("[ref=") && actedRoles.has(roleOf(line)));
    const lower = line.toLowerCase();
    return acted && words.every((word) => lower.includes(word));
  };
}

/** Cuts text to `most` characters at a line's end where it can, and says whether it cut. */
export function cutAtLine(text: string, most: number): PageSnapshot {
  if (text.length <= most) {
    return { snapshot: text, cut: false };
  }
  const head = text.slice(0, most);
  const end = head.lastIndexOf("\n");
  return { snapshot: end > most / 2 ? head.slice(0, end) : head, cut: true };
}

/** Keeps the lines of a snapshot the filter asks for, cut to fit the answer. */
export function filterSnapshot(snapshot: string, filter: SnapshotFilter): PageSnapshot {
  const lines = snapshot.split("\n").filter(keeps(filter));
  return cutAtLine(lines.join("\n"), browserLimits.maxSnapshotChars);
}

/**
 * The page's accessibility tree as Playwright writes it for a model, with a ref (`e12`) on each
 * element that an act's `aria-ref` locator finds, frames included, filtered and cut to fit.
 */
export async function snapshotOf(
  page: Page,
  call: SnapshotFilter & { readonly timeoutMs: number },
): Promise<PageSnapshot> {
  const tree = await page.ariaSnapshot({ mode: "ai", timeout: call.timeoutMs });
  return filterSnapshot(tree, call);
}
