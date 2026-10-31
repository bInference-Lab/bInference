import { z } from "zod";

/**
 * The role of an agent's wallet beside its main ones: `launch` for the launch wallet (decision
 * 0217), which alone makes launch calls; `bridge` for the bridge wallet (decision 0303), which alone
 * deposits into a bridge whose deposit names no recipient. A main wallet has none.
 */
export type WalletRole = "launch" | "bridge";

/** Parses a {@link WalletRole}. */
export const walletRoleSchema: z.ZodType<WalletRole, WalletRole> = z.enum(["launch", "bridge"]);
