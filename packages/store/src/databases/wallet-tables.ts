import type { Generated } from "kysely";

// The tables of the install's wallets, as SQLite returns them: migration 0003 defines them, and
// migration 0038 adds `wallets.role`, and migration 0051 lets it hold `bridge`.

/** `ceilings`: the policy mirror as JSON text, the cap as decimal text. */
export interface CeilingsTable {
  wallet_id: string;
  policy_id: string;
  policy: string;
  per_tx_native: string;
  read_at: number;
  version: number;
}

/**
 * `wallets`: `role` is `agent`, `launch` for an agent's launch wallet, or `bridge` for its bridge
 * wallet.
 */
export interface WalletsTable {
  id: string;
  agent_id: string;
  family: string;
  custody: string;
  custody_wallet_id: string;
  policy_id: string;
  signer_id: string;
  address: string;
  label: string;
  created_at: number;
  archived_at: number | null;
  role: Generated<string>;
}

/** The wallet tables the store adapters query, by name. */
export interface WalletTables {
  wallets: WalletsTable;
  ceilings: CeilingsTable;
}
