import type { OperationName } from "../operations/operations.js";
import { browserExamples } from "./browser-examples.js";
import { chartExamples } from "./chart-examples.js";
import { chatDeleteExamples } from "./chat-delete-examples.js";
import {
  chatExamples,
  limitExamples,
  noteExamples,
  questionExamples,
  reasoningExamples,
} from "./chat-examples.js";
import { configProposalExamples } from "./config-proposal-examples.js";
import { credentialExamples } from "./credential-examples.js";
import { depositExamples } from "./deposit-examples.js";
import { agentExamples, engineExamples, walletExamples } from "./engine-examples.js";
import { fileExamples } from "./file-examples.js";
import { goalExamples } from "./goal-examples.js";
import { helperExamples } from "./helper-examples.js";
import { httpExamples } from "./http-examples.js";
import { imageExamples } from "./image-examples.js";
import {
  bridgeExamples,
  launchDraftExamples,
  launchpadExamples,
  stakingExamples,
} from "./launch-examples.js";
import { intentExamples, marketExamples, orderExamples } from "./market-examples.js";
import { mediaExamples } from "./media-examples.js";
import { pdfExamples } from "./pdf-examples.js";
import { screenExamples } from "./screen-examples.js";
import { sentFileExamples } from "./sent-file-examples.js";
import {
  accessExamples,
  binanceAgentExamples,
  pluginExamples,
  settingsExamples,
  streamExamples,
  webPushExamples,
} from "./settings-examples.js";
import { shellExamples } from "./shell-examples.js";
import { skillProposalExamples } from "./skill-proposal-examples.js";
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
  ...chatDeleteExamples,
  ...imageExamples,
  ...configProposalExamples,
  ...reasoningExamples,
  ...shellExamples,
  ...browserExamples,
  ...pdfExamples,
  ...screenExamples,
  ...httpExamples,
  ...fileExamples,
  ...sentFileExamples,
  ...mediaExamples,
  ...chartExamples,
  ...credentialExamples,
  ...depositExamples,
  ...helperExamples,
  ...goalExamples,
  ...skillProposalExamples,
  ...questionExamples,
  ...noteExamples,
  ...pluginExamples,
  ...settingsExamples,
  ...accessExamples,
  ...webPushExamples,
  ...streamExamples,
  ...binanceAgentExamples,
};
