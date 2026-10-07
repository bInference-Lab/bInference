import type { Migration } from "../migration.js";
import { migration as meta } from "./0001_meta.js";
import { migration as installAndSafety } from "./0002_install_and_safety.js";
import { migration as agentsAndWallets } from "./0003_agents_and_wallets.js";
import { migration as intentsAndTransactions } from "./0004_intents_and_transactions.js";
import { migration as ordersAndRules } from "./0005_orders_and_rules.js";
import { migration as ledger } from "./0006_ledger.js";
import { migration as marketData } from "./0007_market_data.js";
import { migration as surfacesAndDelivery } from "./0008_surfaces_and_delivery.js";
import { migration as accessAndOperations } from "./0009_access_and_operations.js";
import { migration as transactionSends } from "./0010_transaction_sends.js";

/** The engine database's migrations, oldest first. Released files never change. */
export const engineMigrations: readonly Migration[] = [
  meta,
  installAndSafety,
  agentsAndWallets,
  intentsAndTransactions,
  ordersAndRules,
  ledger,
  marketData,
  surfacesAndDelivery,
  accessAndOperations,
  transactionSends,
];
