import { z } from "zod";

/**
 * The role of an agent's wallet beside its main ones: `launch` for the launch wallet (decision
 * 0217), which alone makes launch calls; `bridge` for the bridge wallet (decision 0303), which alone
 * deposits into a bridge whose deposit names no recipient. A main wallet has none.
 */
export type WalletRole = "launch" | "bridge";

/** Parses a {@link WalletRole}. */
export const walletRoleSchema: z.ZodType<WalletRole, WalletRole> = z.enum(["launch", "bridge"]);

/**
 * Whether a wallet of the role also makes a main wallet's calls, so its ceiling holds a main
 * wallet's calls, spenders and bridge deposits beside its role's own: a launch wallet trades as a
 * main wallet does (decision 0217); a bridge wallet makes only its role's deposits (decision 0307).
 */
export const roleMakesMainCalls: Readonly<Record<WalletRole, boolean>> = {
  launch: true,
  bridge: false,
};
