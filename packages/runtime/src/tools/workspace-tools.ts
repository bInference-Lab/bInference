import { BinferenceError } from "@binference/core";
import {
  type AgentEditableFile,
  agentEditableFiles,
  agentFileMaxChars,
} from "@binference/protocol";
import { z } from "zod";
import type { ToolOutcome } from "../loop/turn-records.js";
import { agentToolTexts } from "./agent-tool-texts.js";
import { type AgentTool, defineTool } from "./define-tool.js";
import { failedAnswer } from "./tool-answer.js";
import type { AgentToolParts } from "./tool-client.js";

// The agent's writes to the owner's workspace files (decision 0242): `STRATEGY.md` and
// `PERSONA.md` through `agent/editFile`, and the first chat's end through `agent/endFirstChat`.

const writeArgs: z.ZodType<{ readonly file: AgentEditableFile; readonly text: string }> =
  z.strictObject({
    file: z.enum(agentEditableFiles),
    text: z.string().min(1).max(agentFileMaxChars),
  });

const endArgs: z.ZodType<Readonly<Record<string, never>>> = z.strictObject({});

// The engine's refusals the model reads as what to do next; any other error code is the tool's
// failure, and anything else stays a fault of the call.
const answers: Readonly<Record<string, ToolOutcome>> = {
  "agent.file_untrusted": {
    text: "not saved: this conversation holds outside content, so the owner's files cannot take text from it. The file is unchanged. Tell the owner: their answers are saved once they send /clear and give them again, or they can edit the file in the console.",
    isError: true,
  },
  "agent.file_missing": { text: "The first chat had already ended.", isError: false },
};

async function answered(tool: string, work: () => Promise<ToolOutcome>): Promise<ToolOutcome> {
  try {
    return await work();
  } catch (error) {
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    return answers[error.code] ?? failedAnswer(tool, error);
  }
}

const ended =
  "The first chat ended: FIRST-CHAT.md is removed, and the owner is told that STRATEGY.md and PERSONA.md hold their answers.";

/**
 * `workspace_write` and `first_chat_end`, control tools for one agent (decision 0242):
 * `workspace_write` replaces `STRATEGY.md` or `PERSONA.md` whole, which the engine refuses from a
 * turn whose context holds outside content; `first_chat_end` removes `FIRST-CHAT.md`, and the turn
 * that removed it ends with the line `turn.firstChatDone`.
 */
export function workspaceTools({ agent, client }: AgentToolParts): readonly AgentTool[] {
  const write = defineTool({
    name: "workspace_write",
    kind: "control",
    description: agentToolTexts.workspace_write,
    args: writeArgs,
    run: async ({ file, text }, { signal, idempotencyKey }) =>
      answered("workspace_write", async () => {
        await client.call("agent/editFile", { agent, file, text }, { signal, key: idempotencyKey });
        return { text: `Saved ${file}; it applies from the next turn.`, isError: false };
      }),
  });
  const end = defineTool({
    name: "first_chat_end",
    kind: "control",
    description: agentToolTexts.first_chat_end,
    args: endArgs,
    run: async (_args, { signal, idempotencyKey }) =>
      answered("first_chat_end", async () => {
        await client.call("agent/endFirstChat", { agent }, { signal, key: idempotencyKey });
        return { text: ended, isError: false, closingLine: "firstChatDone" };
      }),
  });
  return [write, end];
}
