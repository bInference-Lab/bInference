import { type BrowserRequest, browserRequestSchema } from "@binference/protocol";
import { z } from "zod";

const actions = [
  "status",
  "start",
  "stop",
  "tabs",
  "open",
  "focus",
  "close",
  "navigate",
  "snapshot",
  "screenshot",
  "text",
  "console",
  "pdf",
  "act",
] as const;

const actKinds = [
  "click",
  "type",
  "press",
  "hover",
  "select",
  "fill",
  "scrollIntoView",
  "drag",
  "wait",
  "evaluate",
  "resize",
  "close",
] as const;

/**
 * The arguments of `browse` as the model writes them: one flat object, `action` and, for `act`,
 * `kind` choosing which fields count, as one request of the protocol reads them.
 */
export interface BrowseArgs {
  readonly action: (typeof actions)[number];
  readonly tab?: string;
  readonly url?: string;
  readonly timeoutMs?: number;
  readonly interactive?: boolean;
  readonly query?: string;
  readonly fullPage?: boolean;
  readonly ref?: string;
  readonly selector?: string;
  readonly maxChars?: number;
  readonly limit?: number;
  /** What to look for in a screenshot. */
  readonly question?: string;
  readonly kind?: (typeof actKinds)[number];
  readonly doubleClick?: boolean;
  readonly button?: "left" | "right" | "middle";
  readonly modifiers?: readonly ("Alt" | "Control" | "Meta" | "Shift")[];
  readonly text?: string;
  readonly submit?: boolean;
  readonly slowly?: boolean;
  readonly key?: string;
  readonly values?: readonly string[];
  readonly fields?: readonly { readonly ref: string; readonly value: string }[];
  readonly startRef?: string;
  readonly endRef?: string;
  readonly timeMs?: number;
  readonly textGone?: string;
  readonly loadState?: "load" | "domcontentloaded" | "networkidle";
  readonly fn?: string;
  readonly width?: number;
  readonly height?: number;
}

const short = z.string().min(1).max(1_000);

/** Parses {@link BrowseArgs}: every field the request takes, checked in full once it is built. */
export const browseArgsSchema: z.ZodType<BrowseArgs> = z.strictObject({
  action: z.enum(actions),
  tab: z.string().max(16).exactOptional(),
  url: z.string().max(2_048).exactOptional(),
  timeoutMs: z.int().min(1).max(25_000).exactOptional(),
  interactive: z.boolean().exactOptional(),
  query: z.string().max(200).exactOptional(),
  fullPage: z.boolean().exactOptional(),
  ref: z.string().max(32).exactOptional(),
  selector: short.exactOptional(),
  maxChars: z.int().min(100).max(9_000).exactOptional(),
  limit: z.int().min(1).max(50).exactOptional(),
  question: short.exactOptional(),
  kind: z.enum(actKinds).exactOptional(),
  doubleClick: z.boolean().exactOptional(),
  button: z.enum(["left", "right", "middle"]).exactOptional(),
  modifiers: z
    .array(z.enum(["Alt", "Control", "Meta", "Shift"]))
    .max(4)
    .readonly()
    .exactOptional(),
  text: z.string().max(10_000).exactOptional(),
  submit: z.boolean().exactOptional(),
  slowly: z.boolean().exactOptional(),
  key: z.string().max(64).exactOptional(),
  values: z.array(short).max(50).readonly().exactOptional(),
  fields: z
    .array(z.strictObject({ ref: z.string().max(32), value: z.string().max(10_000) }))
    .max(50)
    .readonly()
    .exactOptional(),
  startRef: z.string().max(32).exactOptional(),
  endRef: z.string().max(32).exactOptional(),
  timeMs: z.int().min(0).max(25_000).exactOptional(),
  textGone: short.exactOptional(),
  loadState: z.enum(["load", "domcontentloaded", "networkidle"]).exactOptional(),
  fn: z.string().max(20_000).exactOptional(),
  width: z.int().min(200).max(8_192).exactOptional(),
  height: z.int().min(200).max(8_192).exactOptional(),
});

type Field = keyof BrowseArgs;

// The fields each action reads, the action itself aside.
const actionFields: Readonly<Record<BrowseArgs["action"], readonly Field[]>> = {
  status: [],
  start: [],
  stop: [],
  tabs: [],
  open: ["url"],
  focus: ["tab"],
  close: ["tab"],
  navigate: ["url", "timeoutMs", "tab"],
  snapshot: ["interactive", "query", "tab"],
  screenshot: ["fullPage", "ref", "tab"],
  text: ["selector", "maxChars", "tab"],
  console: ["limit", "tab"],
  pdf: ["tab"],
  act: ["tab"],
};

// The fields each act kind reads, its kind aside.
const kindFields: Readonly<Record<NonNullable<BrowseArgs["kind"]>, readonly Field[]>> = {
  click: ["ref", "doubleClick", "button", "modifiers", "timeoutMs"],
  type: ["ref", "text", "submit", "slowly", "timeoutMs"],
  press: ["key", "ref", "timeoutMs"],
  hover: ["ref", "timeoutMs"],
  select: ["ref", "values", "timeoutMs"],
  fill: ["fields", "timeoutMs"],
  scrollIntoView: ["ref", "timeoutMs"],
  drag: ["startRef", "endRef", "timeoutMs"],
  wait: ["timeMs", "text", "textGone", "selector", "url", "loadState", "timeoutMs"],
  evaluate: ["fn", "ref", "timeoutMs"],
  resize: ["width", "height"],
  close: [],
};

function picked(args: BrowseArgs, fields: readonly Field[]): Readonly<Record<string, unknown>> {
  return Object.fromEntries(
    fields.flatMap((field) => (args[field] === undefined ? [] : [[field, args[field]]])),
  );
}

/**
 * The protocol request a call names, its fields for its action and kind alone, or why it is not
 * one: a missing field, a ref or a tab id of the wrong shape.
 */
export function browserRequestOf(args: BrowseArgs): {
  readonly request?: BrowserRequest;
  readonly problem?: string;
} {
  const own = picked(args, actionFields[args.action]);
  const act =
    args.kind === undefined
      ? undefined
      : { kind: args.kind, ...picked(args, kindFields[args.kind]) };
  if (args.action === "act" && act === undefined) {
    return {
      problem:
        "act needs kind: click, type, press, hover, select, fill, scrollIntoView, drag, wait, evaluate, resize or close.",
    };
  }
  const built = browserRequestSchema.safeParse({
    action: args.action,
    ...own,
    ...(args.action === "act" ? { act } : {}),
  });
  if (built.success) {
    return { request: built.data };
  }
  const issue = built.error.issues[0];
  const where = issue === undefined ? "" : issue.path.join(".");
  return {
    problem: `The ${args.action} call is not right${where === "" ? "" : ` at ${where}`}: ${issue?.message ?? "check its fields"}.`,
  };
}
