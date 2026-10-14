import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * An agent's wallet: its account and the owner's label for it, and its role when it is the
 * agent's launch wallet.
 */
export interface WalletView {
  readonly wallet: ProtocolId<"wallet">;
  readonly agent: ProtocolId<"agent">;
  readonly address: AccountRef;
  readonly label: string;
  readonly createdAt: number;
  readonly archivedAt?: number;
  /**
   * `launch` for the agent's launch wallet, which alone trades on the contracts each launch makes
   * (decision 0217); absent for an agent wallet.
   */
  readonly role?: "launch";
}

/** Parses a wallet view. */
export const walletViewSchema: z.ZodType<WalletView> = z.object({
  wallet: protocolIdSchema("wallet"),
  agent: protocolIdSchema("agent"),
  address: accountRefSchema,
  label: z.string(),
  createdAt: epochMsSchema,
  archivedAt: epochMsSchema.exactOptional(),
  role: z.literal("launch").exactOptional(),
});
