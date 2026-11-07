import type { OperationName } from "../operations/operations.js";
import { chartExamples } from "./chart-examples.js";
import {
  chatExamples,
  imageExamples,
  limitExamples,
  noteExamples,
  questionExamples,
  reasoningExamples,
} from "./chat-examples.js";
import { credentialExamples } from "./credential-examples.js";
import { depositExamples } from "./deposit-examples.js";
import { agentExamples, engineExamples, walletExamples } from "./engine-examples.js";
import { fileExamples } from "./file-examples.js";
import {
  bridgeExamples,
  launchDraftExamples,
  launchpadExamples,
  stakingExamples,
} from "./launch-examples.js";
import { intentExamples, marketExamples, orderExamples } from "./market-examples.js";
import {
  accessExamples,
  binanceAgentExamples,
  pluginExamples,
  settingsExamples,
  streamExamples,
  webPushExamples,
} from "./settings-examples.js";
import { shellExamples } from "./shell-examples.js";
import type { WireExample } from "./wire-values.js";

/** A valid call of every operation, its args and result as JSON carries them. */
export const operationExamples: { readonly [N in OperationName]: WireExample } = {
  ...engineExamples,
  ...agentExamples,
  ...walletExamples,
  ...marketExamples,
  ...launchpadExamples,
  ...stakingExamples,
  ...bridgeExamples,
  ...launchDraftExamples,
  ...intentExamples,
  ...orderExamples,
  ...limitExamples,
  ...chatExamples,
  ...imageExamples,
  ...reasoningExamples,
  ...shellExamples,
  ...fileExamples,
  ...chartExamples,
  ...credentialExamples,
  ...depositExamples,
  ...questionExamples,
  ...noteExamples,
  ...pluginExamples,
  ...settingsExamples,
  ...accessExamples,
  ...webPushExamples,
  ...streamExamples,
  ...binanceAgentExamples,
};
