import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { type WalletView, walletViewSchema } from "../views/wallet-view.schema.js";
import { type OperationTable, readFlags } from "./operation.schema.js";

/**
 * The args of `turn/deposit`: the agent, the turn that shows the owner how to fund it, and one of
 * its wallets; every wallet the agent runs from when left out.
 */
interface DepositArgs {
  readonly agent: ProtocolId<"agent">;
  readonly turn: ProtocolId<"chatTurn">;
  readonly wallet?: ProtocolId<"wallet">;
}

/** What `turn/deposit` showed the owner: each wallet, with the address its QR code holds. */
interface DepositShown {
  readonly wallets: readonly WalletView[];
}

/** The operation the agent shows the owner where to send funds with (decision 0380). */
export interface DepositOperationShapes {
  readonly "turn/deposit": { readonly args: DepositArgs; readonly result: DepositShown };
}

/** The deposit operation, by name. */
export const depositOperations: OperationTable<DepositOperationShapes> = {
  "turn/deposit": {
    ...readFlags,
    name: "turn/deposit",
    scope: "agent",
    args: z.strictObject({
      agent: protocolIdSchema("agent"),
      turn: protocolIdSchema("chatTurn"),
      wallet: protocolIdSchema("wallet").exactOptional(),
    }),
    result: z.object({ wallets: z.array(walletViewSchema) }),
  },
};
