import { z } from "zod";
import {
  maxConsoleMessages,
  maxConsoleTextChars,
  maxPageTextChars,
  maxProblemChars,
  maxSnapshotChars,
  maxTabs,
  maxValueChars,
} from "../operations/browser-limits.js";

/** One tab of the agent's browser: its id, its address and its title. */
export interface BrowserTabView {
  /** Such as `t1`, kept while the browser runs. */
  readonly tab: string;
  readonly url: string;
  readonly title: string;
}

/** One message a page wrote to its console. */
export interface ConsoleMessageView {
  /** Such as `log`, `warning` or `error`, or `pageerror` for an error nothing caught. */
  readonly level: string;
  readonly text: string;
}

/** A screenshot or a PDF the engine saved in the agent's workspace. */
export interface BrowserFileView {
  /** Its absolute path on the engine's machine. */
  readonly path: string;
  readonly contentType: "image/png" | "image/jpeg" | "application/pdf";
  readonly bytes: number;
}

/**
 * What one `browser/run` answers (decision 0401): whether the browser runs, the tab it acted on,
 * and what the action read. Every answer carries outside content: any page may hold any words.
 */
export interface BrowserView {
  readonly running: boolean;
  /** Whether it runs without a window, when it runs. */
  readonly headless?: boolean;
  /** The tab the action acted on, as it is after it. */
  readonly tab?: BrowserTabView;
  /** Every tab, for `tabs`, `open`, `focus` and `close`. */
  readonly tabs?: readonly BrowserTabView[];
  /** The page's accessibility tree, a ref on each element an act names. */
  readonly snapshot?: string;
  /** The page's prose, for `text`. */
  readonly text?: string;
  /** The snapshot or the text was cut to fit. */
  readonly cut?: boolean;
  /** The newest console messages, for `console`. */
  readonly console?: readonly ConsoleMessageView[];
  /** The screenshot or the PDF the action saved. */
  readonly file?: BrowserFileView;
  /** An `evaluate` act's result as JSON text, cut to fit. */
  readonly value?: string;
  /** Why the action ran and failed, such as a ref no element holds now. */
  readonly problem?: string;
}

const tabView: z.ZodType<BrowserTabView> = z.object({
  tab: z.string().min(1).max(16),
  url: z.string().max(8_192),
  title: z.string().max(1_000),
});

/** Parses a {@link BrowserView}. */
export const browserViewSchema: z.ZodType<BrowserView> = z.object({
  running: z.boolean(),
  headless: z.boolean().exactOptional(),
  tab: tabView.exactOptional(),
  tabs: z.array(tabView).max(maxTabs).readonly().exactOptional(),
  snapshot: z.string().max(maxSnapshotChars).exactOptional(),
  text: z.string().max(maxPageTextChars).exactOptional(),
  cut: z.boolean().exactOptional(),
  console: z
    .array(z.object({ level: z.string().max(32), text: z.string().max(maxConsoleTextChars) }))
    .max(maxConsoleMessages)
    .readonly()
    .exactOptional(),
  file: z
    .object({
      path: z.string().min(1).max(4_096),
      contentType: z.enum(["image/png", "image/jpeg", "application/pdf"]),
      bytes: z.int().nonnegative(),
    })
    .exactOptional(),
  value: z.string().max(maxValueChars).exactOptional(),
  problem: z.string().max(maxProblemChars).exactOptional(),
});
