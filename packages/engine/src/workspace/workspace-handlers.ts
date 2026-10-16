import { err, ok, type Result, type WorkspaceFiles } from "@binference/core";
import type { ProtocolErrorCode, ProtocolId } from "@binference/protocol";
import type { EngineHandler } from "../operations/engine-call.js";
import type { AgentStore } from "../ports.js";

/** The handlers of an agent's workspace files (protocol spec, section 7.2). */
export interface WorkspaceHandlers {
  readonly "agent/readFile": EngineHandler<"agent/readFile">;
  readonly "agent/writeFile": EngineHandler<"agent/writeFile">;
  readonly "agent/editFile": EngineHandler<"agent/editFile">;
  readonly "agent/endFirstChat": EngineHandler<"agent/endFirstChat">;
}

/** What the workspace handlers read and write. */
export interface WorkspaceHandlerParts {
  readonly agents: AgentStore;
  readonly workspace: WorkspaceFiles;
}

// An agent the engine holds and has not archived, or why a write to its files is refused.
async function writable(
  agents: AgentStore,
  agent: ProtocolId<"agent">,
  signal: AbortSignal,
): Promise<Result<void, ProtocolErrorCode>> {
  const settings = await agents.get(agent, { signal });
  if (settings === undefined) {
    return err("agent.not_found");
  }
  return settings.agent.archivedAtMs === undefined ? ok(undefined) : err("agent.archived");
}

/**
 * Creates the workspace handlers over the workspace store: `agent/readFile` answers one file's
 * text and when it changed, `agent.file_missing` for a file the agent does not have;
 * `agent/writeFile` replaces a file whole for the owner. `agent/editFile` replaces `STRATEGY.md`
 * or `PERSONA.md` for the agent, only from a running turn of the runtime whose context holds no
 * outside content, else `agent.file_untrusted`; `agent/endFirstChat` removes `FIRST-CHAT.md`,
 * `agent.file_missing` once it is gone (decision 0242). Every write refuses an archived agent, and
 * each answers `agent.not_found` for an agent the engine does not hold. The next turn reads what
 * was written.
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
      const found = await writable(agents, args.agent, signal);
      if (!found.ok) {
        return found;
      }
      const place = { agent: args.agent, file: args.file };
      return ok({ updatedAt: await workspace.write(place, args.text, signal) });
    },
    async "agent/editFile"({ args, caller, signal }) {
      const found = await writable(agents, args.agent, signal);
      if (!found.ok) {
        return found;
      }
      // The mark comes from the engine's record of the runtime's running turn, never the caller.
      if (caller.turn?.hasOutsideContent !== false) {
        return err("agent.file_untrusted");
      }
      const place = { agent: args.agent, file: args.file };
      return ok({ updatedAt: await workspace.write(place, args.text, signal) });
    },
    async "agent/endFirstChat"({ args, signal }) {
      const found = await writable(agents, args.agent, signal);
      if (!found.ok) {
        return found;
      }
      const removed = await workspace.remove({ agent: args.agent, file: "FIRST-CHAT.md" }, signal);
      return removed.ok ? ok({}) : err("agent.file_missing");
    },
  };
}
