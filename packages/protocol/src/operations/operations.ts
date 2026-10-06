import { type AccessOperationShapes, accessOperations } from "./access-operations.schema.js";
import { type AgentOperationShapes, agentOperations } from "./agent-operations.schema.js";
import {
  type BinanceAgentOperationShapes,
  binanceAgentOperations,
} from "./binance-agent-operations.schema.js";
import { type ChatOperationShapes, chatOperations } from "./chat-operations.schema.js";
import { type EngineOperationShapes, engineOperations } from "./engine-operations.schema.js";
import { type IntentOperationShapes, intentOperations } from "./intent-operations.schema.js";
import { type LimitOperationShapes, limitOperations } from "./limit-operations.schema.js";
import { type MarketOperationShapes, marketOperations } from "./market-operations.schema.js";
import { type NoteOperationShapes, noteOperations } from "./note-operations.schema.js";
import type { OperationTable } from "./operation.schema.js";
import { type OrderOperationShapes, orderOperations } from "./order-operations.schema.js";
import { type PluginOperationShapes, pluginOperations } from "./plugin-operations.schema.js";
import { type SettingsOperationShapes, settingsOperations } from "./settings-operations.schema.js";
import { type StreamOperationShapes, streamOperations } from "./stream-operations.schema.js";
import { type WalletOperationShapes, walletOperations } from "./wallet-operations.schema.js";

/**
 * The args and result types of every operation, by name. A typed client calls
 * `call<N extends OperationName>(op: N, args: ArgsOf<N>): Promise<ResultOf<N>>`.
 */
export interface OperationShapes
  extends
    EngineOperationShapes,
    AgentOperationShapes,
    WalletOperationShapes,
    MarketOperationShapes,
    IntentOperationShapes,
    OrderOperationShapes,
    LimitOperationShapes,
    ChatOperationShapes,
    NoteOperationShapes,
    PluginOperationShapes,
    SettingsOperationShapes,
    AccessOperationShapes,
    StreamOperationShapes,
    BinanceAgentOperationShapes {}

/** The name of an operation, such as `intent/propose`. */
export type OperationName = keyof OperationShapes;

/** The args an operation takes, as its callers write them. */
export type ArgsOf<N extends OperationName> = OperationShapes[N]["args"];

/** The result an operation answers with. */
export type ResultOf<N extends OperationName> = OperationShapes[N]["result"];

/** Every operation of the protocol, by name, grouped as protocol spec section 7 groups them. */
export const operations: OperationTable<OperationShapes> = {
  ...engineOperations,
  ...agentOperations,
  ...walletOperations,
  ...marketOperations,
  ...intentOperations,
  ...orderOperations,
  ...limitOperations,
  ...chatOperations,
  ...noteOperations,
  ...pluginOperations,
  ...settingsOperations,
  ...accessOperations,
  ...streamOperations,
  ...binanceAgentOperations,
};

/** Whether a text names an operation of the protocol. */
export function isOperationName(text: string): text is OperationName {
  return Object.hasOwn(operations, text);
}

/** The name of every operation of the protocol, in the order of the table. */
export const operationNames: readonly OperationName[] =
  Object.keys(operations).filter(isOperationName);
