import { type AccountRef, accountRefSchema } from "@binference/chain";
import { z } from "zod";
import { type ProtocolId, protocolIdSchema } from "../ids/id-prefixes.js";
import { epochMsSchema } from "../values/epoch-ms.schema.js";

/**
 * An agent's wallet: its account and the owner's label for it, and its role when it is the
 * agent's launch wallet or its bridge wallet.
 */
export interface WalletView {
  readonly wallet: ProtocolId<"wallet">;
  readonly agent: ProtocolId<"agent">;
  readonly address: AccountRef;
  /**
   * The name of the chain the address is on, as binference's chain list writes it, such as BNB
   * Smart Chain. An older engine leaves it out; a surface then names the chain by `address`.
   */
  readonly chainName?: string;
  /**
   * The address's page on the first block explorer binference's chain list names for its chain,
   * such as `https://bscscan.com/address/0x…`. Absent when the list names no explorer for it, or
   * from an older engine; a surface then shows no link.
   */
  readonly explorerLink?: string;
  readonly label: string;
  readonly createdAt: number;
  readonly archivedAt?: number;
  /**
   * `launch` for the agent's launch wallet, which alone trades on the contracts each launch makes
   * (decision 0217); absent for an agent wallet.
   */
  readonly role?: "launch";
  /**
   * `true` for the agent's bridge wallet, which alone makes the deposits bridge venues mark as a
   * bridge wallet's, such as Relay's, and holds nothing else in its ceiling (decisions 0303 and
   * 0307); absent for any other wallet. `role` stays the launch wallet's, as protocol version 1
   * shows it.
   */
  readonly bridge?: true;
  /**
   * `true` for a live launch or bridge wallet beyond the agent's wallet of that role, as a rebuild
   * may adopt (decision 0218): nothing runs from it, and the owner rescues what it holds. Only
   * `wallet/list` sets it.
   */
  readonly extra?: boolean;
  /**
   * The functions an agent's launch or bridge wallet needs that its ceiling, as last read back,
   * does not allow: calls a venue the agent uses marks as that wallet's, such as a create call
   * added after the wallet was made (decision 0271). The owner key writes the ceiling again with
   * `ceiling/set`. Only `wallet/list` sets it.
   */
  readonly missingCalls?: readonly string[];
}

/** Parses a wallet view. */
export const walletViewSchema: z.ZodType<WalletView> = z.object({
  wallet: protocolIdSchema("wallet"),
  agent: protocolIdSchema("agent"),
  address: accountRefSchema,
  chainName: z.string().min(1).max(200).exactOptional(),
  explorerLink: z
    .url({ protocol: /^https$/u })
    .max(2048)
    .exactOptional(),
  label: z.string(),
  createdAt: epochMsSchema,
  archivedAt: epochMsSchema.exactOptional(),
  role: z.literal("launch").exactOptional(),
  bridge: z.literal(true).exactOptional(),
  extra: z.boolean().exactOptional(),
  missingCalls: z.array(z.string().min(1)).exactOptional(),
});
