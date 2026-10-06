import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import type { AgentArgs } from "../values/agent-args.schema.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type Page, type PageArgs, pageArgsShape, pageSchema } from "../values/page.schema.js";
import { plainIdSchema } from "../values/plain-id.schema.js";
import { routedReadFlags, routedWriteFlags, type OperationTable } from "./operation.schema.js";

/** One note of the agent's long-term memory, labelled by its origin. */
interface NoteView {
  readonly note: string;
  readonly agent: ProtocolId<"agent">;
  readonly text: string;
  readonly origin: "owner" | "agent" | "untrusted" | "system";
  readonly createdAt: number;
  readonly changedAt: number;
}

/** The args of `notes/search`. */
interface SearchNotesArgs extends AgentArgs {
  readonly query: string;
  readonly limit?: number;
}

/** The args of `notes/write`. The engine sets the note's origin from the caller. */
interface WriteNoteArgs extends AgentArgs {
  readonly text: string;
}

/**
 * The notes operations of protocol spec section 7.7. The agent runtime answers them through the
 * engine; while it is down they fail with `runtime.unavailable`.
 */
export interface NoteOperationShapes {
  readonly "notes/search": { readonly args: SearchNotesArgs; readonly result: Page<NoteView> };
  readonly "notes/list": {
    readonly args: AgentArgs & PageArgs;
    readonly result: Page<NoteView>;
  };
  readonly "notes/write": { readonly args: WriteNoteArgs; readonly result: NoteView };
  readonly "notes/delete": { readonly args: { readonly note: string }; readonly result: Empty };
}

const agent = protocolIdSchema("agent");
const noteView = z.object({
  note: plainIdSchema,
  agent,
  text: z.string(),
  origin: z.enum(["owner", "agent", "untrusted", "system"]),
  createdAt: epochMsSchema,
  changedAt: epochMsSchema,
});

/** The notes operations, by name. */
export const noteOperations: OperationTable<NoteOperationShapes> = {
  "notes/search": {
    ...routedReadFlags,
    name: "notes/search",
    scope: "read",
    args: z.strictObject({
      agent,
      query: z.string().min(1),
      limit: pageArgsShape.limit,
    }),
    result: pageSchema(noteView),
  },
  "notes/list": {
    ...routedReadFlags,
    name: "notes/list",
    scope: "read",
    args: z.strictObject({ ...pageArgsShape, agent }),
    result: pageSchema(noteView),
  },
  "notes/write": {
    ...routedWriteFlags,
    name: "notes/write",
    scope: "agent",
    scopeCase: { scope: "admin", when: "ownerNote" },
    args: z.strictObject({ agent, text: z.string().min(1) }),
    result: noteView,
  },
  "notes/delete": {
    ...routedWriteFlags,
    name: "notes/delete",
    scope: "admin",
    args: z.strictObject({ note: plainIdSchema }),
    result: emptyResultSchema,
  },
};
