import type { OperationName } from "../operations/operations.js";
import {
  chatExamples,
  imageExamples,
  limitExamples,
  noteExamples,
  questionExamples,
} from "./chat-examples.js";
import { agentExamples, engineExamples, walletExamples } from "./engine-examples.js";
import { intentExamples, marketExamples, orderExamples } from "./market-examples.js";
import {
  accessExamples,
  binanceAgentExamples,
  pluginExamples,
  settingsExamples,
  streamExamples,
  webPushExamples,
} from "./settings-examples.js";
import type { WireExample } from "./wire-values.js";

/** A valid call of every operation, its args and result as JSON carries them. */
export const operationExamples: { readonly [N in OperationName]: WireExample } = {
  ...engineExamples,
  ...agentExamples,
  ...walletExamples,
  ...marketExamples,
  ...intentExamples,
  ...orderExamples,
  ...limitExamples,
  ...chatExamples,
  ...imageExamples,
  ...questionExamples,
  ...noteExamples,
  ...pluginExamples,
  ...settingsExamples,
  ...accessExamples,
  ...webPushExamples,
  ...streamExamples,
  ...binanceAgentExamples,
};
