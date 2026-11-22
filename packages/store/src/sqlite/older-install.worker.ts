import { BinferenceError } from "@binference/core";
import { engineMigrations } from "../migrations/engine/engine-migrations.js";
import { oldestUpdatedEngineSchemaVersion } from "../migrations/known-schema-versions.js";
import { runMigrations } from "../migrations/run-migrations.js";
import { openConnection } from "./open-connection.worker.js";

/** An install an older release set up: the schema it left and the owner key it seals to. */
export interface OlderInstall {
  /** The schema version `engine.sqlite` stays at, from the oldest an update starts from. */
  readonly version: number;
  /** The owner key's public half, DER SubjectPublicKeyInfo in base64. */
  readonly ownerKeyPublic: string;
}

// The rows name only columns of the oldest schema an update starts from, so they plant the same
// install on every version from it on.
const custody = `INSERT INTO custody (id, provider, app_id, owner_quorum_id, owner_key_public,
  agent_quorum_id, agent_key_public, attached_at)
  VALUES (1, 'privy', 'older-app', 'owner-quorum', ?, 'agent-quorum', 'YWdlbnQga2V5', 1000)`;
const agent = `INSERT INTO agents (id, name, mode, locale, models, notifications, created_at,
  changed_at) VALUES ('agt_0190f1c2-3a4b-7c5d-8e6f-000000000001', 'older', 'live', 'en', '{}',
  '{}', 1000, 1000)`;
const wallet = `INSERT INTO wallets (id, agent_id, family, custody, custody_wallet_id, policy_id,
  signer_id, address, label, created_at, archived_at)
  VALUES (?, 'agt_0190f1c2-3a4b-7c5d-8e6f-000000000001', 'evm', 'privy', ?, 'older-policy',
  'agent-quorum', ?, 'main', ?, ?)`;
const ceiling = `INSERT INTO ceilings (wallet_id, policy_id, policy, per_tx_native, read_at)
  VALUES (?, 'older-policy', '[]', '1000000000000000000', 1000)`;

/**
 * For tests: writes `engine.sqlite` at `file` as an older release left it, migrated to
 * `install.version` and no further, with its custody and two wallets, `older-wallet-1` live and
 * `older-wallet-2` archived. A version older than the oldest an update starts from, or newer than
 * this build's, is a fault.
 */
export function writeOlderInstall(file: string, install: OlderInstall): void {
  const { version } = install;
  if (version < oldestUpdatedEngineSchemaVersion || version > engineMigrations.length) {
    throw new BinferenceError({
      code: "store.version_unplanted",
      message: `An older install is planted from schema ${String(oldestUpdatedEngineSchemaVersion)} to ${String(engineMigrations.length)}, not ${String(version)}.`,
      details: { version },
    });
  }
  const database = openConnection(file, { role: "writer", synchronous: "full" });
  try {
    runMigrations(database, { name: "engine", migrations: engineMigrations.slice(0, version) });
    database.prepare(custody).run(install.ownerKeyPublic);
    database.prepare(agent).run();
    for (const n of [1, 2]) {
      const id = `wal_0190f1c2-3a4b-7c5d-8e6f-00000000000${String(n)}`;
      const archivedAt = n === 2 ? 3000 : null;
      const address = `0x${String(n).repeat(40)}`;
      database.prepare(wallet).run(id, `older-wallet-${String(n)}`, address, 1000 * n, archivedAt);
      database.prepare(ceiling).run(id);
    }
  } finally {
    database.close();
  }
}
