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

// `identities`: each agent's one identity in a chain's identity registry (migration 0058).
interface IdentitiesTable {
  agent_id: string;
  chain: string;
  registry: string;
  onchain_id: string;
  tx_hash: string;
  registered_at: number;
  file: string;
}

/** The wallet tables the store adapters query, by name, with the agents' identities. */
export interface WalletTables {
  wallets: WalletsTable;
  ceilings: CeilingsTable;
  identities: IdentitiesTable;
}
