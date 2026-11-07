import { maxImagesPerMessage } from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { filePathOf } from "./image-places.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

/** The most images one `show_images` call shows. */
const mostImages = 12;

const refusals: Readonly<Record<string, string>> = {
  "image.not_found":
    "No file has one of those paths; nothing was shown. Check the paths with file_read or shell.",
  "image.too_large":
    "One of those images is over 5 MiB, which the chat does not take; nothing was shown.",
  "image.format": "One of those files is no PNG, JPEG or WebP image; nothing was shown.",
  "image.unreadable": "The images could not be read; nothing was shown. Try again.",
  "image.walled":
    "One of those files is inside binference's own folder, which is walled off; nothing was shown. Never try to reach it another way.",
  "image.outside_workspace":
    "The owner keeps your files inside your workspace (files.workspaceOnly), so a file outside it is refused; nothing was shown.",
};

const showArgs = z.strictObject({
  paths: z.array(z.string().trim().min(1).max(4_096)).min(1).max(mostImages),
  caption: z.string().trim().min(1).max(500),
});

// The paths in groups of as many as one message holds, in order.
function groupsOf(paths: readonly string[]): readonly (readonly string[])[] {
  return Array.from({ length: Math.ceil(paths.length / maxImagesPerMessage) }, (_, index) =>
    paths.slice(index * maxImagesPerMessage, (index + 1) * maxImagesPerMessage),
  );
}

function shownOutcome(paths: readonly string[]): ToolOutcome {
  const text = [
    `The owner now sees ${String(paths.length)} image(s) in this chat, above your answer, each with where it is saved:`,
    ...paths,
    "Do not repeat the paths or describe the images unless the owner asks; your answer may be empty.",
  ].join("\n");
  return { text, isError: false, shown: paths };
}

// Some groups went out before one was refused: what the owner sees, then why the rest did not go.
function stoppedOutcome(shown: readonly string[], refusal: string): ToolOutcome {
  const seen = shownOutcome(shown);
  const rest = refusal.replace("nothing was shown", "the images after these were not shown");
  return { text: `${seen.text}\n${rest}`, isError: true, shown };
}

/**
 * `show_images`, a control tool (decision 0399): shows the owner, in the chat of the turn, images
 * that are already on the machine, such as the ones the agent made before or a screenshot, by
 * their paths. The engine reads each as `look_at_image` reads a file, so binference's own folder
 * stays walled off, and sends them as photos; up to 4 go in each message. A group that cannot be
 * read shows nothing, and the answer names it.
 */
export function showImagesTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "show_images",
    kind: "control",
    description: agentToolTexts.show_images,
    args: showArgs,
    run: async ({ paths, caption }, { signal }) => {
      const shown: string[] = [];
      for (const group of groupsOf(paths.map(filePathOf))) {
        const args = { agent, turn: turn.turn, paths: group, caption };
        // oxlint-disable-next-line eslint/no-await-in-loop -- the groups reach the chat in order, and a refusal stops the rest
        const answer = await answerOrRefusal({ tool: "show_images", refusals }, async () => {
          const shownNow = await client.call("image/show", args, { signal });
          shown.push(...shownNow.images.map(({ path }) => path));
          return shownOutcome(shown);
        });
        if (answer.isError) {
          return shown.length === 0 ? answer : stoppedOutcome(shown, answer.text);
        }
      }
      return shownOutcome(shown);
    },
  });
}
