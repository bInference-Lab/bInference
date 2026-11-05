import type { ChainRegistry, Signer, WalletRole } from "@binference/chain";
import type { WalletView } from "@binference/protocol";
import type { WalletRecord } from "../install/install-record.js";

/** What a wallet view reads its address from: custody's account on each registered chain. */
export interface WalletViewParts {
  readonly custody: Signer;
  readonly chains: ChainRegistry;
}

/**
 * What a wallet view shows of a wallet's role: `role: "launch"` for a launch wallet, `bridge: true`
 * for a bridge wallet (decision 0307), nothing for a main wallet.
 */
export function roleMarksOf(role: WalletRole | undefined): Pick<WalletView, "role" | "bridge"> {
  const marks: Readonly<Record<WalletRole, Pick<WalletView, "role" | "bridge">>> = {
    launch: { role: "launch" },
    bridge: { bridge: true },
  };
  return role === undefined ? {} : marks[role];
}

/**
 * A stored wallet as the protocol shows it, with its account on the first registered chain where
 * custody holds it, that chain's name, and its role when it is a launch or bridge wallet;
 * `undefined` when custody holds it on none, so no wallet is ever shown without the address
 * custody signs for.
 */
export async function walletViewOf(
  parts: WalletViewParts,
  wallet: WalletRecord,
  signal: AbortSignal,
): Promise<WalletView | undefined> {
  const held = await Promise.all(
    parts.chains.list().map(async (chain) => {
      const account = await parts.custody.account(wallet.id, chain.ref, { signal });
      return account.ok ? [{ address: account.value, chainName: chain.definition.name }] : [];
    }),
  );
  const [first] = held.flat();
  return first === undefined
    ? undefined
    : {
        wallet: wallet.id,
        agent: wallet.agentId,
        address: first.address,
        chainName: first.chainName,
        label: wallet.label,
        createdAt: wallet.createdAtMs,
        ...(wallet.archivedAtMs === undefined ? {} : { archivedAt: wallet.archivedAtMs }),
        ...roleMarksOf(wallet.role),
      };
}
