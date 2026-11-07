import type { ConfigProposalOperationShapes } from "../operations/config-proposal-operations.schema.js";
import { at, ids, type WireExample } from "./wire-values.js";

const patch = { models: { imageMaking: "openai/gpt-image-1" } };

/** Example calls of the operations that read the config and propose a change (decision 0393). */
export const configProposalExamples: {
  readonly [N in keyof ConfigProposalOperationShapes]: WireExample;
} = {
  "config/view": {
    args: { path: "models.imageMaking" },
    result: {
      value: "openai/gpt-image-1",
      rules: [
        {
          path: "models.imageMaking",
          description: "The model that makes images.",
          takes: "a model as <provider>/<model>",
        },
      ],
      hash: "9f2c1a7e5b3d4c6f8a0b2d4e6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a",
    },
  },
  "config/propose": {
    args: {
      patch,
      reason: "The owner asked for OpenAI's newest image model.",
      baseHash: "9f2c1a7e5b3d4c6f8a0b2d4e6f8a1c3e5b7d9f0a2c4e6b8d0f1a3c5e7b9d2f4a",
    },
    result: {
      intent: ids.intent,
      agent: ids.agent,
      wallet: ids.wallet,
      kind: "configChange",
      state: "awaiting_confirmation",
      request: {
        kind: "configChange",
        patch,
        reason: "The owner asked for OpenAI's newest image model.",
      },
      card: {
        card: ids.card,
        version: 1,
        opensAt: at,
        expiresAt: at + 600_000,
        paper: false,
        outsideContent: false,
      },
      paper: false,
      outsideContent: false,
      assets: {},
      createdAt: at,
      changedAt: at,
    },
  },
};
