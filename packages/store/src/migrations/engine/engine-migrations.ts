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
import { migration as sendLevelRows } from "./0011_send_level_rows.js";
import { migration as rescueCeiling } from "./0012_rescue_ceiling.js";
import { migration as pendingLimits } from "./0013_pending_limits.js";
import { migration as transactionReplacements } from "./0014_transaction_replacements.js";
import { migration as positionsAndDepartures } from "./0015_positions_and_departures.js";
import { migration as intentValues } from "./0016_intent_values.js";
import { migration as executionRealized } from "./0017_execution_realized.js";
import { migration as noticeIntents } from "./0018_notice_intents.js";

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
  sendLevelRows,
  rescueCeiling,
  pendingLimits,
  transactionReplacements,
  positionsAndDepartures,
  intentValues,
  executionRealized,
  noticeIntents,
];
