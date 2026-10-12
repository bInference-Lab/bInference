import type { WorkspaceFiles } from "@binference/core";
import { createFormatter } from "@binference/i18n";
import { type Locale, type WorkspaceFile, workspaceFiles } from "@binference/protocol";

// Each file's template among the workspace messages.
const templates: Readonly<Record<WorkspaceFile, string>> = {
  "RULES.md": "workspace.rules",
  "PERSONA.md": "workspace.persona",
  "OWNER.md": "workspace.owner",
  "STRATEGY.md": "workspace.strategy",
  "NOTES.md": "workspace.notes",
  "FIRST-CHAT.md": "workspace.firstChat",
};

/** A new agent, and the owner its files describe. */
export interface NewWorkspace {
  readonly agent: string;
  /** The agent's name, which the files call it by. */
  readonly name: string;
  /** The owner's language, which the files are written in. */
  readonly locale: Locale;
  /** The owner's timezone, an IANA name such as `Asia/Shanghai`. */
  readonly timeZone: string;
}

/**
 * Makes a new agent's workspace files from their templates, in the owner's language: `RULES.md`,
 * `PERSONA.md`, `OWNER.md`, `STRATEGY.md`, `NOTES.md` and `FIRST-CHAT.md`, the first-chat script
 * (spec 4, section 8.3). A file the agent already has is left as it is, so making them again
 * changes nothing the owner or the agent wrote. Rejects when the store cannot write.
 */
export async function makeAgentWorkspace(
  files: WorkspaceFiles,
  workspace: NewWorkspace,
  signal: AbortSignal,
): Promise<void> {
  const formatter = createFormatter({ locale: workspace.locale, timeZone: workspace.timeZone });
  const values = {
    agent: workspace.name,
    language: formatter.message(`language.${workspace.locale}`),
    timeZone: workspace.timeZone,
  };
  for (const file of workspaceFiles) {
    // oxlint-disable-next-line eslint/no-await-in-loop -- one file at a time, in the context's order
    await files.create(
      { agent: workspace.agent, file },
      formatter.message(templates[file], values),
      signal,
    );
  }
}
