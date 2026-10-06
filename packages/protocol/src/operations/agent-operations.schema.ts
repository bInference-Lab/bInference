import { type AccountRef, accountRefSchema, isTxHash, type TxHash } from "@binference/chain";
import { z } from "zod";
import { protocolIdSchema } from "../ids/id-prefixes.js";
import { type Locale, localeSchema } from "../locale.js";
import { type AgentArgs, agentArgsSchema } from "../values/agent-args.schema.js";
import { type Empty, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type Page, type PageArgs, pageArgsSchema, pageSchema } from "../values/page.schema.js";
import { type AgentView, agentViewSchema } from "../views/agent-view.schema.js";
import { type IntentView, intentViewSchema } from "../views/intent-view.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

const workspaceFiles = [
  "RULES.md",
  "PERSONA.md",
  "OWNER.md",
  "STRATEGY.md",
  "NOTES.md",
  "FIRST-CHAT.md",
] as const;

/** One of an agent's workspace files. */
type WorkspaceFile = (typeof workspaceFiles)[number];

/** The args of `agent/readFile`. */
interface FileArgs extends AgentArgs {
  readonly file: WorkspaceFile;
}

/** The args of `agent/writeFile`. */
interface WriteFileArgs extends FileArgs {
  readonly text: string;
}

/** The args of `agent/create`: a new agent starts in paper mode with the default limits. */
interface CreateAgentArgs {
  readonly name: string;
  readonly locale?: Locale;
}

/** The args of `agent/rename`. */
interface RenameAgentArgs extends AgentArgs {
  readonly name: string;
}

/** An agent's entry in the chain's agent identity registry. */
interface IdentityRegistration {
  readonly registry: AccountRef;
  readonly onchainId: string;
  readonly txHash: TxHash;
  readonly registeredAt: number;
}

/** The agent operations of protocol spec section 7.2, and the identity ones of section 7.9. */
export interface AgentOperationShapes {
  readonly "agent/list": { readonly args: PageArgs; readonly result: Page<AgentView> };
  readonly "agent/get": { readonly args: AgentArgs; readonly result: AgentView };
  readonly "agent/create": { readonly args: CreateAgentArgs; readonly result: AgentView };
  readonly "agent/rename": { readonly args: RenameAgentArgs; readonly result: AgentView };
  readonly "agent/archive": { readonly args: AgentArgs; readonly result: Empty };
  readonly "agent/goLive": { readonly args: AgentArgs; readonly result: AgentView };
  readonly "agent/goPaper": { readonly args: AgentArgs; readonly result: AgentView };
  readonly "agent/readFile": {
    readonly args: FileArgs;
    readonly result: { readonly text: string; readonly updatedAt: number };
  };
  readonly "agent/writeFile": {
    readonly args: WriteFileArgs;
    readonly result: { readonly updatedAt: number };
  };
  readonly "identity/get": {
    readonly args: AgentArgs;
    readonly result: { readonly registration?: IdentityRegistration };
  };
  /** The registration is an intent awaiting a tap. */
  readonly "identity/register": { readonly args: AgentArgs; readonly result: IntentView };
}

const agentName = z.string().min(1).max(64);
const agentFile = { agent: protocolIdSchema("agent"), file: z.enum(workspaceFiles) };

/** The agent and identity operations, by name. */
export const agentOperations: OperationTable<AgentOperationShapes> = {
  "agent/list": {
    ...readFlags,
    name: "agent/list",
    scope: "read",
    args: pageArgsSchema,
    result: pageSchema(agentViewSchema),
  },
  "agent/get": {
    ...readFlags,
    name: "agent/get",
    scope: "read",
    args: agentArgsSchema,
    result: agentViewSchema,
  },
  "agent/create": {
    ...writeFlags,
    name: "agent/create",
    scope: "admin",
    args: z.strictObject({ name: agentName, locale: localeSchema.exactOptional() }),
    result: agentViewSchema,
  },
  "agent/rename": {
    ...writeFlags,
    name: "agent/rename",
    scope: "admin",
    args: z.strictObject({ agent: protocolIdSchema("agent"), name: agentName }),
    result: agentViewSchema,
  },
  "agent/archive": {
    ...writeFlags,
    name: "agent/archive",
    scope: "admin",
    args: agentArgsSchema,
    result: emptyResultSchema,
  },
  "agent/goLive": {
    ...localWriteFlags,
    name: "agent/goLive",
    scope: "admin",
    args: agentArgsSchema,
    result: agentViewSchema,
  },
  "agent/goPaper": {
    ...writeFlags,
    name: "agent/goPaper",
    scope: "confirm",
    args: agentArgsSchema,
    result: agentViewSchema,
  },
  "agent/readFile": {
    ...readFlags,
    name: "agent/readFile",
    scope: "read",
    args: z.strictObject(agentFile),
    result: z.object({ text: z.string(), updatedAt: epochMsSchema }),
  },
  "agent/writeFile": {
    ...writeFlags,
    name: "agent/writeFile",
    scope: "admin",
    args: z.strictObject({ ...agentFile, text: z.string() }),
    result: z.object({ updatedAt: epochMsSchema }),
  },
  "identity/get": {
    ...readFlags,
    name: "identity/get",
    scope: "read",
    args: agentArgsSchema,
    result: z.object({
      registration: z
        .object({
          registry: accountRefSchema,
          onchainId: z.string().min(1),
          txHash: z.string().refine(isTxHash),
          registeredAt: epochMsSchema,
        })
        .exactOptional(),
    }),
  },
  "identity/register": {
    ...writeFlags,
    name: "identity/register",
    scope: "propose",
    args: agentArgsSchema,
    result: intentViewSchema,
  },
};
