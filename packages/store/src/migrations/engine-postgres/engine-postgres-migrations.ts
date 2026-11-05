import type { PostgresMigration } from "../postgres-migration.js";
import { migration as meta } from "./0001_meta.js";
import { migration as installAndSafety } from "./0002_install_and_safety.js";
import { migration as agentsAndWallets } from "./0003_agents_and_wallets.js";
import { migration as intentsAndTransactions } from "./0004_intents_and_transactions.js";
import { migration as ordersAndRules } from "./0005_orders_and_rules.js";

/** The engine schema's Postgres migrations, oldest first. Released files never change. */
export const enginePostgresMigrations: readonly PostgresMigration[] = [
  meta,
  installAndSafety,
  agentsAndWallets,
  intentsAndTransactions,
  ordersAndRules,
];
