import { fileLimits } from "@binference/protocol";
import { z } from "zod";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { filePathOf } from "./image-places.js";
import { answerOrRefusal } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

const refusals: Readonly<Record<string, string>> = {
  "file.not_found":
    "No file has one of those paths; nothing was sent. Check the paths with file_read or shell.",
  "file.is_folder":
    "One of those paths is a folder; nothing was sent. Send its files, or pack the folder into one file with shell first.",
  "file.too_large":
    "One of those files is over 20 MiB, which the chat does not take; nothing was sent. Tell the owner where it is, or make a smaller copy with shell.",
  "file.unreadable": "The files could not be read; nothing was sent. Try again.",
  "file.walled":
    "One of those files is inside binference's own folder, which is walled off; nothing was sent. Never try to reach it another way.",
  "file.outside_workspace":
    "The owner keeps your files inside your workspace (files.workspaceOnly), so a file outside it is refused; nothing was sent.",
  "file.changed":
    "One of those paths led to another file while it was read; nothing was sent. Check the paths with file_read, then send again.",
};

const sendArgs = z.strictObject({
  paths: z.array(z.string().trim().min(1).max(4_096)).min(1).max(fileLimits.maxSentFiles),
  caption: z.string().trim().min(1).max(500),
});

/**
 * `send_files`, a control tool (decision 0400): sends the owner, in the chat of the turn, up to 10
 * files on the machine as documents to save, such as a report the agent wrote or a log. The engine
 * reads each as `file_read` reads a path, so binference's own folder stays walled off and
 * `files.workspaceOnly` holds, at most 20 MiB each; every file must read before any is sent.
 */
export function sendFilesTool({ agent, client, turn }: AgentToolParts): AgentTool {
  return defineTool({
    name: "send_files",
    kind: "control",
    description: agentToolTexts.send_files,
    args: sendArgs,
    run: async ({ paths, caption }, { signal }) =>
      answerOrRefusal({ tool: "send_files", refusals }, async () => {
        const args = { agent, turn: turn.turn, paths: paths.map(filePathOf), caption };
        const sent = await client.call("file/send", args, { signal });
        const lines = sent.files.map(({ name, path }) => `${name}: ${path}`);
        const text = [
          `The owner now has ${String(lines.length)} file(s) in this chat to save, above your answer:`,
          ...lines,
          "Do not repeat the paths; your answer may be empty.",
        ].join("\n");
        return { text, isError: false, shown: lines };
      }),
  });
}
