import { type AccessOperationShapes, accessOperations } from "./access-operations.schema.js";
import { type AgentOperationShapes, agentOperations } from "./agent-operations.schema.js";
import {
  type BinanceAgentOperationShapes,
  binanceAgentOperations,
} from "./binance-agent-operations.schema.js";
import { type BridgeOperationShapes, bridgeOperations } from "./bridge-operations.schema.js";
import { type BrowserOperationShapes, browserOperations } from "./browser-operations.schema.js";
import { type ChartOperationShapes, chartOperations } from "./chart-operations.schema.js";
import {
  type ChatDeleteOperationShapes,
  chatDeleteOperations,
} from "./chat-delete-operations.schema.js";
import { type ChatOperationShapes, chatOperations } from "./chat-operations.schema.js";
import {
  type ConfigProposalOperationShapes,
  configProposalOperations,
} from "./config-proposal-operations.schema.js";
import {
  type CredentialOperationShapes,
  credentialOperations,
} from "./credential-operations.schema.js";
import { type DepositOperationShapes, depositOperations } from "./deposit-operations.schema.js";
import { type EngineOperationShapes, engineOperations } from "./engine-operations.schema.js";
import { type FileOperationShapes, fileOperations } from "./file-operations.schema.js";
import { type GoalOperationShapes, goalOperations } from "./goal-operations.schema.js";
import { type HelperOperationShapes, helperOperations } from "./helper-operations.schema.js";
import { type HttpOperationShapes, httpOperations } from "./http-operations.schema.js";
import { type ImageOperationShapes, imageOperations } from "./image-operations.schema.js";
import { type IntentOperationShapes, intentOperations } from "./intent-operations.schema.js";
import {
  type LaunchDraftOperationShapes,
  launchDraftOperations,
} from "./launch-draft-operations.schema.js";
import {
  type LaunchpadOperationShapes,
  launchpadOperations,
} from "./launchpad-operations.schema.js";
import { type LimitOperationShapes, limitOperations } from "./limit-operations.schema.js";
import { type MarketOperationShapes, marketOperations } from "./market-operations.schema.js";
import { type MediaOperationShapes, mediaOperations } from "./media-operations.schema.js";
import { type NoteOperationShapes, noteOperations } from "./note-operations.schema.js";
import type { OperationTable } from "./operation.schema.js";
import { type OrderOperationShapes, orderOperations } from "./order-operations.schema.js";
import { type PdfOperationShapes, pdfOperations } from "./pdf-operations.schema.js";
import { type PluginOperationShapes, pluginOperations } from "./plugin-operations.schema.js";
import { type QuestionOperationShapes, questionOperations } from "./question-operations.schema.js";
import {
  type ReasoningOperationShapes,
  reasoningOperations,
} from "./reasoning-operations.schema.js";
import { type ScreenOperationShapes, screenOperations } from "./screen-operations.schema.js";
import { type SentFileOperationShapes, sentFileOperations } from "./sent-file-operations.schema.js";
import { type SettingsOperationShapes, settingsOperations } from "./settings-operations.schema.js";
import { type ShellOperationShapes, shellOperations } from "./shell-operations.schema.js";
import {
  type SkillProposalOperationShapes,
  skillProposalOperations,
} from "./skill-proposal-operations.schema.js";
import { type StakingOperationShapes, stakingOperations } from "./staking-operations.schema.js";
import { type StreamOperationShapes, streamOperations } from "./stream-operations.schema.js";
import { type WalletOperationShapes, walletOperations } from "./wallet-operations.schema.js";
import { type WebPushOperationShapes, webPushOperations } from "./web-push-operations.schema.js";

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
    LaunchpadOperationShapes,
    StakingOperationShapes,
    BridgeOperationShapes,
    LaunchDraftOperationShapes,
    IntentOperationShapes,
    OrderOperationShapes,
    LimitOperationShapes,
    ChatOperationShapes,
    ChatDeleteOperationShapes,
    ImageOperationShapes,
    ConfigProposalOperationShapes,
    ReasoningOperationShapes,
    ShellOperationShapes,
    BrowserOperationShapes,
    PdfOperationShapes,
    ScreenOperationShapes,
    HttpOperationShapes,
    FileOperationShapes,
    SentFileOperationShapes,
    MediaOperationShapes,
    ChartOperationShapes,
    CredentialOperationShapes,
    DepositOperationShapes,
    HelperOperationShapes,
    GoalOperationShapes,
    SkillProposalOperationShapes,
    QuestionOperationShapes,
    NoteOperationShapes,
    PluginOperationShapes,
    SettingsOperationShapes,
    AccessOperationShapes,
    WebPushOperationShapes,
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
  ...launchpadOperations,
  ...stakingOperations,
  ...bridgeOperations,
  ...launchDraftOperations,
  ...intentOperations,
  ...orderOperations,
  ...limitOperations,
  ...chatOperations,
  ...chatDeleteOperations,
  ...imageOperations,
  ...configProposalOperations,
  ...reasoningOperations,
  ...shellOperations,
  ...browserOperations,
  ...pdfOperations,
  ...screenOperations,
  ...httpOperations,
  ...fileOperations,
  ...sentFileOperations,
  ...mediaOperations,
  ...chartOperations,
  ...credentialOperations,
  ...depositOperations,
  ...helperOperations,
  ...goalOperations,
  ...skillProposalOperations,
  ...questionOperations,
  ...noteOperations,
  ...pluginOperations,
  ...settingsOperations,
  ...accessOperations,
  ...webPushOperations,
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
