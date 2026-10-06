import { type AssetRef, assetRefSchema } from "@binference/chain";
import { decimalStringSchema } from "@binference/core";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type AgentArgs, agentArgsSchema } from "../values/agent-args.schema.js";
import { type Empty, emptyArgsSchema, emptyResultSchema } from "../values/empty.schema.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";
import { labelSchema } from "../values/label.schema.js";
import { type Page, type PageArgs, pageArgsShape, pageSchema } from "../values/page.schema.js";
import { type FileTicket, fileTicketSchema } from "../views/file-ticket.schema.js";
import { localWriteFlags, readFlags, writeFlags, type OperationTable } from "./operation.schema.js";

/** Whether a Binance Agent's hooks let trades through. */
type BinanceAgentState = "running" | "paused" | "stopped";

/** A connected Binance Agent. */
interface BinanceAgentView {
  readonly agent: ProtocolId<"agent">;
  readonly label: string;
  readonly state: BinanceAgentState;
}

/** The limits a Binance Agent's hooks enforce before each trade tool runs; absent ones stay. */
interface BinanceAgentLimits {
  readonly dailyUsdMicros?: bigint;
  readonly perTradeUsdMicros?: bigint;
  readonly allowTokens?: readonly AssetRef[];
  readonly denyTokens?: readonly AssetRef[];
}

/**
 * One trade or refused call of a Binance Agent, as its hooks reported it. The fields follow the
 * Binance Agents spec, which this version leaves open.
 */
type BinanceAgentEvent = Readonly<Record<string, unknown>>;

/** The args of `binanceAgent/record`: a time range, as a verified record or a CSV file. */
interface RecordArgs extends AgentArgs {
  readonly from: number;
  readonly to: number;
  readonly format?: "json" | "csv";
}

/** The Binance Agent operations of protocol spec section 7.10. */
export interface BinanceAgentOperationShapes {
  readonly "binanceAgent/list": { readonly args: Empty; readonly result: Page<BinanceAgentView> };
  /** Installs the agent's hooks in its folder. */
  readonly "binanceAgent/connect": {
    readonly args: { readonly folder: string; readonly label: string };
    readonly result: BinanceAgentView;
  };
  readonly "binanceAgent/timeline": {
    readonly args: AgentArgs & PageArgs;
    readonly result: Page<BinanceAgentEvent>;
  };
  readonly "binanceAgent/setLimits": {
    readonly args: AgentArgs & { readonly limits: BinanceAgentLimits };
    readonly result: BinanceAgentLimits;
  };
  readonly "binanceAgent/pause": {
    readonly args: AgentArgs;
    readonly result: { readonly state: BinanceAgentState };
  };
  readonly "binanceAgent/resume": {
    readonly args: AgentArgs;
    readonly result: { readonly state: BinanceAgentState };
  };
  /** Also disconnects the agent. */
  readonly "binanceAgent/stop": {
    readonly args: AgentArgs;
    readonly result: { readonly state: BinanceAgentState };
  };
  readonly "binanceAgent/record": {
    readonly args: RecordArgs;
    readonly result: Page<BinanceAgentEvent> | FileTicket;
  };
  /** Sent by the agent's hooks over IPC. */
  readonly "binanceAgent/report": {
    readonly args: AgentArgs & { readonly event: BinanceAgentEvent };
    readonly result: Empty;
  };
}

const agent = protocolIdSchema("agent");
const state = z.enum(["running", "paused", "stopped"]);
const stateView = z.object({ state });
const event = z.record(z.string(), z.unknown());
const limitsShape = {
  dailyUsdMicros: decimalStringSchema.exactOptional(),
  perTradeUsdMicros: decimalStringSchema.exactOptional(),
  allowTokens: z.array(assetRefSchema).exactOptional(),
  denyTokens: z.array(assetRefSchema).exactOptional(),
};

/** The Binance Agent operations, by name. */
export const binanceAgentOperations: OperationTable<BinanceAgentOperationShapes> = {
  "binanceAgent/list": {
    ...readFlags,
    name: "binanceAgent/list",
    scope: "read",
    args: emptyArgsSchema,
    result: pageSchema(z.object({ agent, label: z.string(), state })),
  },
  "binanceAgent/connect": {
    ...localWriteFlags,
    name: "binanceAgent/connect",
    scope: "admin",
    args: z.strictObject({ folder: z.string().min(1), label: labelSchema }),
    result: z.object({ agent, label: z.string(), state }),
  },
  "binanceAgent/timeline": {
    ...readFlags,
    name: "binanceAgent/timeline",
    scope: "read",
    args: z.strictObject({ ...pageArgsShape, agent }),
    result: pageSchema(event),
  },
  "binanceAgent/setLimits": {
    ...writeFlags,
    name: "binanceAgent/setLimits",
    scope: "confirm",
    scopeCase: { scope: "admin", when: "looser" },
    args: z.strictObject({ agent, limits: z.strictObject(limitsShape) }),
    result: z.object(limitsShape),
  },
  "binanceAgent/pause": {
    ...writeFlags,
    name: "binanceAgent/pause",
    scope: "confirm",
    args: agentArgsSchema,
    result: stateView,
  },
  "binanceAgent/resume": {
    ...writeFlags,
    name: "binanceAgent/resume",
    scope: "admin",
    args: agentArgsSchema,
    result: stateView,
  },
  "binanceAgent/stop": {
    ...writeFlags,
    name: "binanceAgent/stop",
    scope: "confirm",
    args: agentArgsSchema,
    result: stateView,
  },
  "binanceAgent/record": {
    ...writeFlags,
    name: "binanceAgent/record",
    scope: "read",
    args: z.strictObject({
      agent,
      from: epochMsSchema,
      to: epochMsSchema,
      format: z.enum(["json", "csv"]).exactOptional(),
    }),
    result: z.union([pageSchema(event), fileTicketSchema]),
  },
  "binanceAgent/report": {
    ...writeFlags,
    name: "binanceAgent/report",
    scope: "agent",
    args: z.strictObject({ agent, event }),
    result: emptyResultSchema,
  },
};
