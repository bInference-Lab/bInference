import type { AgentMode, WalletView } from "@binference/protocol";
import type { Formatter } from "../format/create-formatter.js";

/** What a wallet is for, as `cmd.wallet.role` names it. */
export type WalletRoleName = "agent" | "launch" | "bridge" | "extraLaunch" | "extraBridge";

/** A wallet a surface shows the owner to fund: the wallet, and its agent's mode and freeze. */
export interface DepositWallet {
  readonly view: WalletView;
  readonly mode: AgentMode;
  readonly isFrozen: boolean;
}

/**
 * A wallet's role as `cmd.wallet.role` names it: the agent's own wallet, its launch or bridge
 * wallet, or a launch or bridge wallet beyond the agent's own of that role, which nothing runs
 * from (decision 0218).
 */
export function walletRoleOf(view: WalletView): WalletRoleName {
  const isExtra = view.extra === true;
  if (view.role === "launch") {
    return isExtra ? "extraLaunch" : "launch";
  }
  if (view.bridge === true) {
    return isExtra ? "extraBridge" : "bridge";
  }
  return "agent";
}

/**
 * What the owner must know before sending to a wallet (spec 4, section 5), in order: the network
 * `chain` names, a paper agent's real funds, a freeze. A wallet nothing runs from says only to send
 * it nothing.
 */
export function depositWarnings(
  formatter: Formatter,
  wallet: DepositWallet,
  chain: string,
): readonly string[] {
  if (wallet.view.extra === true) {
    return [formatter.message("cmd.wallet.extraFunds")];
  }
  return [
    formatter.message("cmd.wallet.network", { chain }),
    ...(wallet.mode === "paper" ? [formatter.message("cmd.wallet.paperFunds")] : []),
    ...(wallet.isFrozen ? [formatter.message("cmd.wallet.frozenFunds")] : []),
  ];
}
