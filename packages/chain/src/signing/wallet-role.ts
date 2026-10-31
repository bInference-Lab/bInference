import { z } from "zod";

/**
 * The role of an agent's wallet beside its main ones: `launch` for the launch wallet (decision
 * 0217), which alone makes launch calls. A main wallet has none.
 */
export type WalletRole = "launch";

/** Parses a {@link WalletRole}. */
export const walletRoleSchema: z.ZodType<WalletRole, WalletRole> = z.literal("launch");
