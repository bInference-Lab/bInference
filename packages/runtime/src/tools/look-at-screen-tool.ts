import { maxDisplayNumber, type ScreenCaptureView } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome, ToolRunContext } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { lookAtPlaces } from "./look-at-image-tool.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The args of `look_at_screen`: one display by its number, and what to look for. */
interface LookAtScreenArgs {
  readonly display?: number;
  readonly question?: string;
}

const screenArgs: z.ZodType<LookAtScreenArgs> = z.strictObject({
  display: z.int().min(1).max(maxDisplayNumber).exactOptional(),
  question: z.string().trim().min(1).max(1_000).exactOptional(),
});

// The engine answers within 30 seconds, its screenshot programs within 8 each.
const callTimeoutMs = 31_000;

const defaultQuestion =
  "Describe this screenshot of the owner's screen: the windows and apps on it, the text you can read and what each shows.";

const refusals: Readonly<Record<string, string>> = {
  "screen.no_screen":
    "This machine shows no screen binference can look at, such as a server or a container. Tell the owner.",
  "screen.no_program":
    "No screenshot program binference runs is installed. Tell the owner to install grim, gnome-screenshot or scrot (Linux), then ask again.",
  "screen.no_display":
    "No display has that number, or this machine's screenshot program cannot pick one display. Leave display out to look at the whole screen.",
  "screen.too_large":
    "The screenshot stays over 5 MiB and this machine cannot make it smaller. Ask for one display, or tell the owner to lower the screen's resolution.",
  "screen.failed":
    "The screenshot could not be taken. Tell the owner; the screen may be off or locked.",
  "file.unwritable": "The screenshot could not be saved in your workspace. Try again.",
};

// What the agent reads when the OS has not allowed binference to record the screen.
function blockedText(program: string): string {
  return `The owner's computer has not allowed binference to record the screen, so no screenshot was taken. Tell the owner to open System Settings, Privacy and Security, Screen Recording, turn on the program binference runs as (${program}, or the terminal app that started binference), then restart binference and ask again.`;
}

// Each shot is looked at as look_at_image looks at images, all together, and their paths named.
async function shotLines(
  parts: AgentToolParts,
  view: ScreenCaptureView,
  context: Pick<ToolRunContext, "signal" | "look"> & { readonly question: string },
): Promise<ToolOutcome> {
  const places = view.shots.map((shot) => ({ path: shot.path }));
  const saved = view.shots.map((shot) =>
    shot.display === undefined
      ? `Saved the screenshot at ${shot.path}.`
      : `Saved display ${String(shot.display)} at ${shot.path}.`,
  );
  const seen = await lookAtPlaces(parts, places, context);
  const looked = seen.isError
    ? `It could not be looked at: ${seen.text}`
    : `What it shows: ${seen.text}`;
  const show = "Show it to the owner with show_images only when they ask to see it.";
  return { text: [...saved, show, looked].join("\n"), isError: seen.isError };
}

/**
 * `look_at_screen`, a read tool (decision 0406): takes a screenshot of the owner's screen through
 * the engine's `screen/capture`, every display or the one asked, and answers what the model that
 * looks at images saw in it, with the paths it was saved at. Every answer is outside content: the
 * screen can show anything. Helpers never get it. It only looks, and no tool moves the mouse or
 * presses a key.
 */
export function lookAtScreenTool(parts: AgentToolParts): AgentTool {
  const { agent, client } = parts;
  return defineTool({
    name: "look_at_screen",
    kind: "read",
    outside: true,
    forHelpers: false,
    description: agentToolTexts.look_at_screen,
    args: screenArgs,
    run: async (args, { signal, look }) =>
      answerOrRefusal({ tool: "look_at_screen", refusals }, async (): Promise<ToolOutcome> => {
        const display = args.display === undefined ? {} : { display: args.display };
        const view = await client.call(
          "screen/capture",
          { agent, ...display },
          { signal, timeoutMs: callTimeoutMs },
        );
        if (view.shots.length === 0) {
          const program = view.blocked?.program ?? "binference";
          return { text: blockedText(program), isError: true, closingLine: "screenBlocked" };
        }
        const question = args.question ?? defaultQuestion;
        return shotLines(parts, view, { signal, look, question });
      }),
  });
}
