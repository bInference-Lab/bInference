import type { BrowserView } from "@binference/protocol";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { browseArgsSchema, browserRequestOf } from "./browse-args.schema.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { lookAtPlaces } from "./look-at-image-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

// The engine answers within 30 seconds, an action at most 25 of them; the rest is for the answer.
const callTimeoutMs = 31_000;

const defaultQuestion =
  "Describe this screenshot of a web page: its layout, the text you can read and the controls on it.";

const refusals: Readonly<Record<string, string>> = {
  "browser.off":
    "The owner turned the browser off (browser.enabled is false), so binference opens no page. Tell the owner; read pages with read_page instead.",
  "browser.not_found":
    "No Chrome-family browser is installed on this machine. Tell the owner to install Google Chrome, Microsoft Edge, Brave or Chromium, or to set browser.executablePath.",
  "browser.start_failed":
    "The browser would not start. Tell the owner; the program browser.executablePath names, or the browser found here, may not open.",
  "browser.proxy_held":
    "The owner's proxy (network.proxy) cannot be used, so the browser does not start. Tell the owner to run binference check.",
  "browser.address_refused":
    "That address is refused: binference's own engine, console and folder are never opened, and addresses on this machine or a private network only when the owner sets browser.allowPrivateNetwork. Never try to reach it another way.",
  "browser.tab_not_found":
    "No tab has that id. List the tabs with action tabs and use one of their ids.",
  "browser.evaluate_off":
    "The owner turned scripts off (browser.evaluate is false). Use snapshot, text and act instead.",
  "file.unwritable": "The capture could not be saved in your workspace. Try again.",
};

function tabLines(view: BrowserView): readonly string[] {
  const lines =
    view.tab === undefined ? [] : [`Tab ${view.tab.tab} at ${view.tab.url}: ${view.tab.title}`];
  const tabs = (view.tabs ?? []).map((tab) => `- ${tab.tab}: ${tab.title} (${tab.url})`);
  return tabs.length === 0 ? lines : [...lines, "Tabs:", ...tabs];
}

function readLines(view: BrowserView): readonly string[] {
  const cut = view.cut === true ? ["[cut to fit: narrow it with query, selector or maxChars]"] : [];
  return [
    ...(view.snapshot === undefined ? [] : [view.snapshot]),
    ...(view.text === undefined ? [] : [view.text]),
    ...cut,
    ...(view.console ?? []).map((message) => `[${message.level}] ${message.text}`),
    ...(view.value === undefined ? [] : [`Result: ${view.value}`]),
  ];
}

function textOf(view: BrowserView): string {
  const state = view.running
    ? `The browser runs${view.headless === true ? " without a window" : ""}.`
    : "The browser is not running.";
  const problem = view.problem === undefined ? [] : [`The action failed: ${view.problem}`];
  return [state, ...tabLines(view), ...readLines(view), ...problem].join("\n");
}

// A screenshot is looked at as look_at_image looks at an image, and its path is named so the
// agent can show it; a PDF's path is named so the agent can send it.
async function fileLines(
  parts: AgentToolParts,
  view: BrowserView,
  context: Pick<ToolRunContext, "signal" | "look"> & { readonly question: string },
): Promise<readonly string[]> {
  const { file } = view;
  if (file === undefined) {
    return [];
  }
  if (file.contentType === "application/pdf") {
    return [
      `Saved the page as a PDF at ${file.path}. Send it to the owner with send_files when they ask.`,
    ];
  }
  const seen = await lookAtPlaces(parts, [{ path: file.path }], context);
  const looked = seen.isError
    ? `It could not be looked at: ${seen.text}`
    : `What it shows: ${seen.text}`;
  return [`Saved the screenshot at ${file.path}; show it to the owner with show_images.`, looked];
}

/**
 * `browse`, a machine tool (decision 0401): drives binference's own browser on the engine's
 * machine through `browser/run`, one action a call. Every answer is outside content: any page may
 * hold any words. A screenshot is looked at by the model that looks at images, and its path named.
 */
export function browseTool(parts: AgentToolParts): AgentTool {
  const { agent, client } = parts;
  return defineTool({
    name: "browse",
    kind: "machine",
    outside: true,
    description: agentToolTexts.browse,
    args: browseArgsSchema,
    run: async (args, { signal, look }) => {
      const { request, problem } = browserRequestOf(args);
      if (request === undefined) {
        return { text: problem ?? "That call is not right.", isError: true };
      }
      return answerOrRefusal({ tool: "browse", refusals }, async (): Promise<ToolOutcome> => {
        const view = await client.call(
          "browser/run",
          { agent, request },
          { signal, timeoutMs: callTimeoutMs },
        );
        const question = args.question ?? defaultQuestion;
        const files = await fileLines(parts, view, { signal, look, question });
        return { text: [textOf(view), ...files].join("\n"), isError: view.problem !== undefined };
      });
    },
  });
}
