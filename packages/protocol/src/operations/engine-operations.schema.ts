import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import {
  type EngineDescription,
  engineDescriptionSchema,
} from "../describe/engine-description.schema.js";
import { type EngineState, engineStateSchema } from "../frames/ready-frame.schema.js";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { type AgentMode, agentModeSchema } from "../views/agent-view.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** One health signal of `engine/status`, such as event-loop lag or RPC health. */
interface HealthSignal {
  readonly signal: string;
  readonly state: "ok" | "warn" | "fail";
}

/** The answer of `engine/status`. */
interface EngineStatus {
  readonly state: EngineState;
  readonly version: string;
  readonly protocol: number;
  readonly frozen: boolean;
  readonly agents: readonly {
    readonly id: ProtocolId<"agent">;
    readonly mode: AgentMode;
    readonly frozen: boolean;
  }[];
  readonly health: readonly HealthSignal[];
}

/** The answer of `safety/status`. */
interface SafetyStatus {
  readonly frozen: boolean;
  readonly frozenAt?: number;
  readonly rescueAddress?: AccountRef;
  /** A new rescue address that takes effect 24 hours after it was set. */
  readonly pendingRescueAddress?: AccountRef;
}

/**
 * The args of `engine/unlock`: the owner's passphrase in the `manual` unlock mode; in any other
 * mode none, and the engine reads its source again.
 */
interface UnlockArgs {
  readonly passphrase?: string;
}

/** The args of `safety/freeze` and `safety/unfreeze`: one agent, or every agent when absent. */
interface FreezeArgs {
  readonly agent?: ProtocolId<"agent">;
}

/** The engine and safety operations of protocol spec section 7.1. */
export interface EngineOperationShapes {
  readonly "engine/status": { readonly args: Empty; readonly result: EngineStatus };
  readonly "engine/describe": { readonly args: Empty; readonly result: EngineDescription };
  readonly "engine/stop": { readonly args: Empty; readonly result: Empty };
  readonly "engine/unlock": { readonly args: UnlockArgs; readonly result: Empty };
  readonly "safety/status": { readonly args: Empty; readonly result: SafetyStatus };
  readonly "safety/freeze": {
    readonly args: FreezeArgs;
    readonly result: { readonly frozenAt: number };
  };
  readonly "safety/unfreeze": { readonly args: FreezeArgs; readonly result: Empty };
  readonly "safety/rescue": {
    readonly args: Empty;
    readonly result: { readonly intent: ProtocolId<"intent"> };
  };
  readonly "safety/setRescueAddress": {
    readonly args: { readonly address: AccountRef };
    readonly result: { readonly effectiveAt: number };
  };
  readonly "safety/cancelRescueChange": { readonly args: Empty; readonly result: Empty };
}

const freezeArgs = z.strictObject({ agent: protocolIdSchema("agent").exactOptional() });

/** The engine and safety operations, by name. */
export const engineOperations: OperationTable<EngineOperationShapes> = {
  "engine/status": {
    ...readFlags,
    name: "engine/status",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({
      state: engineStateSchema,
      version: z.string(),
      protocol: z.int().positive(),
      frozen: z.boolean(),
      agents: z.array(
        z.object({ id: protocolIdSchema("agent"), mode: agentModeSchema, frozen: z.boolean() }),
      ),
      health: z.array(z.object({ signal: z.string(), state: z.enum(["ok", "warn", "fail"]) })),
    }),
  },
  "engine/describe": {
    ...readFlags,
    name: "engine/describe",
    scope: "read",
    args: emptyArgsSchema,
    result: engineDescriptionSchema,
  },
  "engine/stop": {
    ...localWriteFlags,
    name: "engine/stop",
    scope: "admin",
    args: emptyArgsSchema,
    result: emptyResultSchema,
  },
  "engine/unlock": {
    ...localWriteFlags,
    name: "engine/unlock",
    scope: "admin",
    args: z.strictObject({
      passphrase: z.string().min(1).max(1024).exactOptional(),
    }),
    result: emptyResultSchema,
  },
  "safety/status": {
    ...readFlags,
    name: "safety/status",
    scope: "read",
    args: emptyArgsSchema,
    result: z.object({
      frozen: z.boolean(),
      frozenAt: epochMsSchema.exactOptional(),
      rescueAddress: accountRefSchema.exactOptional(),
      pendingRescueAddress: accountRefSchema.exactOptional(),
    }),
  },
  "safety/freeze": {
    ...writeFlags,
    name: "safety/freeze",
    scope: "confirm",
    args: freezeArgs,
    result: z.object({ frozenAt: epochMsSchema }),
  },
  "safety/unfreeze": {
    ...writeFlags,
    name: "safety/unfreeze",
    scope: "loosen",
    args: freezeArgs,
    result: emptyResultSchema,
  },
  "safety/rescue": {
    ...writeFlags,
    name: "safety/rescue",
    scope: "confirm",
    args: emptyArgsSchema,
    result: z.object({ intent: protocolIdSchema("intent") }),
  },
  "safety/setRescueAddress": {
    ...writeFlags,
    name: "safety/setRescueAddress",
    scope: "admin",
    args: z.strictObject({ address: accountRefSchema }),
    result: z.object({ effectiveAt: epochMsSchema }),
  },
  "safety/cancelRescueChange": {
    ...writeFlags,
    name: "safety/cancelRescueChange",
    scope: "confirm",
    args: emptyArgsSchema,
    result: emptyResultSchema,
  },
};
