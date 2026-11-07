import type { DepositOperationShapes } from "../operations/deposit-operations.schema.js";
import { ids, walletView, type WireExample } from "./wire-values.js";

/** Example calls of the operation the agent shows the owner where to send funds with. */
export const depositExamples: { readonly [N in keyof DepositOperationShapes]: WireExample } = {
  "turn/deposit": {
    args: { agent: ids.agent, turn: ids.turn },
    result: { wallets: [walletView] },
  },
};
