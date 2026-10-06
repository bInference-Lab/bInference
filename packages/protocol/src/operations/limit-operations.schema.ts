import { z } from "zod";
import { protocolIdSchema } from "../ids/id-prefixes.js";
import { type AgentArgs, agentArgsSchema } from "../values/agent-args.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import {
  type LimitChanges,
  limitChangesSchema,
  type LimitsView,
  limitsViewSchema,
} from "../views/limits-view.schema.js";
import { readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** A send level: 0 (Open) to 3 (Locked), where sends may go among the saved addresses. */
type SendLevel = 0 | 1 | 2 | 3;

/** An agent's send level, and a looser one that waits its 24 hours. */
interface SendLevelView {
  readonly level: SendLevel;
  readonly pending?: { readonly level: SendLevel; readonly effectiveAt: number };
}

/** Whether an agent's trades need a tap: `manual`, or `auto` within the caps. */
type ApprovalMode = "manual" | "auto";

/** An agent's approval mode and when it last changed. */
interface ApprovalModeView {
  readonly mode: ApprovalMode;
  readonly changedAt: number;
}

/**
 * The operations on what braking tightens and loosening relaxes: an agent's limits, send level
 * and approval mode (protocol spec sections 7.6 and 7.2).
 */
export interface LimitOperationShapes {
  readonly "limit/get": { readonly args: AgentArgs; readonly result: LimitsView };
  readonly "limit/set": {
    readonly args: AgentArgs & { readonly changes: LimitChanges };
    readonly result: LimitsView;
  };
  readonly "sendLevel/get": { readonly args: AgentArgs; readonly result: SendLevelView };
  readonly "sendLevel/set": {
    readonly args: AgentArgs & { readonly level: SendLevel };
    readonly result: SendLevelView;
  };
  readonly "sendLevel/cancelPending": {
    readonly args: AgentArgs;
    readonly result: { readonly level: SendLevel };
  };
  readonly "approval/get": { readonly args: AgentArgs; readonly result: ApprovalModeView };
  /** Every surface announces the change. */
  readonly "approval/set": {
    readonly args: AgentArgs & { readonly mode: ApprovalMode };
    readonly result: ApprovalModeView;
  };
}

const agent = protocolIdSchema("agent");
const level = z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]);
const sendLevelView = z.object({
  level,
  pending: z.object({ level, effectiveAt: epochMsSchema }).exactOptional(),
});
const approvalMode = z.enum(["manual", "auto"]);
const approvalModeView = z.object({ mode: approvalMode, changedAt: epochMsSchema });

/** The limit, send level and approval mode operations, by name. */
export const limitOperations: OperationTable<LimitOperationShapes> = {
  "limit/get": {
    ...readFlags,
    name: "limit/get",
    scope: "read",
    args: agentArgsSchema,
    result: limitsViewSchema,
  },
  "limit/set": {
    ...writeFlags,
    name: "limit/set",
    scope: "confirm",
    scopeCase: { scope: "loosen", when: "looser" },
    args: z.strictObject({ agent, changes: limitChangesSchema }),
    result: limitsViewSchema,
  },
  "sendLevel/get": {
    ...readFlags,
    name: "sendLevel/get",
    scope: "read",
    args: agentArgsSchema,
    result: sendLevelView,
  },
  "sendLevel/set": {
    ...writeFlags,
    name: "sendLevel/set",
    scope: "confirm",
    scopeCase: { scope: "loosen", when: "looser" },
    args: z.strictObject({ agent, level }),
    result: sendLevelView,
  },
  "sendLevel/cancelPending": {
    ...writeFlags,
    name: "sendLevel/cancelPending",
    scope: "confirm",
    args: agentArgsSchema,
    result: z.object({ level }),
  },
  "approval/get": {
    ...readFlags,
    name: "approval/get",
    scope: "read",
    args: agentArgsSchema,
    result: approvalModeView,
  },
  "approval/set": {
    ...writeFlags,
    name: "approval/set",
    scope: "confirm",
    scopeCase: { scope: "loosen", when: "autoMode" },
    args: z.strictObject({ agent, mode: approvalMode }),
    result: approvalModeView,
  },
};
