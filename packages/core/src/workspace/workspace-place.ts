import { BinferenceError } from "../errors/binference-error.js";

/** One workspace file: the agent it belongs to, by id, and its name, such as `RULES.md`. */
export interface WorkspacePlace {
  readonly agent: string;
  readonly file: string;
}

/** A workspace file's text and when it last changed, in epoch milliseconds. */
export interface WorkspaceText {
  readonly text: string;
  readonly updatedAtMs: number;
}

// An agent's id as the engine writes it, and a workspace file's name: capitals, digits and
// dashes, then `.md`, such as `FIRST-CHAT.md`. Neither can name a parent folder or another drive.
const agentPattern = /^agt_[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const filePattern = /^[A-Z][A-Z0-9-]{0,31}\.md$/;

/**
 * Checks where a workspace file lives: an agent id such as `agt_0190f1c2-…` and a file name such
 * as `RULES.md`. Throws `platform.workspace_name_invalid` for anything else, before a store
 * touches a file, so no name can reach outside the agent's folder.
 */
export function checkWorkspacePlace(place: WorkspacePlace): void {
  const { agent, file } = place;
  if (!agentPattern.test(agent) || !filePattern.test(file)) {
    throw new BinferenceError({
      code: "platform.workspace_name_invalid",
      message: `${JSON.stringify(`${agent}/${file}`)} is not a workspace file; name an agent id and a file such as RULES.md.`,
      details: { agent, file },
    });
  }
}
