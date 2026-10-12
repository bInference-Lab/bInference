import { err, ok, type WorkspaceFiles } from "@binference/core";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentStore } from "../ports.js";

/** The handlers of an agent's workspace files (protocol spec, section 7.2). */
export interface WorkspaceHandlers {
  readonly "agent/readFile": EngineHandler<"agent/readFile">;
  readonly "agent/writeFile": EngineHandler<"agent/writeFile">;
}

/** What the workspace handlers read and write. */
export interface WorkspaceHandlerParts {
  readonly agents: AgentStore;
  readonly workspace: WorkspaceFiles;
}

/**
 * Creates the workspace handlers over the workspace store: `agent/readFile` answers one file's
 * text and when it changed, `agent.file_missing` for a file the agent does not have;
 * `agent/writeFile` replaces a file whole, and refuses an archived agent. Both answer
 * `agent.not_found` for an agent the engine does not hold. The next turn reads what was written.
 */
export function createWorkspaceHandlers(parts: WorkspaceHandlerParts): WorkspaceHandlers {
  const { agents, workspace } = parts;
  return {
    async "agent/readFile"({ args, signal }) {
      if ((await agents.get(args.agent, { signal })) === undefined) {
        return err("agent.not_found");
      }
      const read = await workspace.read({ agent: args.agent, file: args.file }, signal);
      return read.ok
        ? ok({ text: read.value.text, updatedAt: read.value.updatedAtMs })
        : err("agent.file_missing");
    },
    async "agent/writeFile"({ args, signal }) {
      const settings = await agents.get(args.agent, { signal });
      if (settings === undefined) {
        return err("agent.not_found");
      }
      if (settings.agent.archivedAtMs !== undefined) {
        return err("agent.archived");
      }
      const place = { agent: args.agent, file: args.file };
      return ok({ updatedAt: await workspace.write(place, args.text, signal) });
    },
  };
}
