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
import { migration as telegramOwner } from "./0019_telegram_owner.js";
import { migration as lateLandings } from "./0020_late_landings.js";
import { migration as webPushSubscriptions } from "./0021_web_push_subscriptions.js";
import { migration as tokenExpiry } from "./0022_token_expiry.js";
import { migration as miniAppLaunches } from "./0023_mini_app_launches.js";
import { migration as miniAppTickets } from "./0024_mini_app_tickets.js";
import { migration as carriedOutflows } from "./0025_carried_outflows.js";
import { migration as backupDigests } from "./0026_backup_digests.js";
import { migration as sealKey } from "./0027_seal_key.js";
import { migration as agentInbox } from "./0028_agent_inbox.js";
import { migration as cardPlaces } from "./0029_card_places.js";
import { migration as telegramTopics } from "./0030_telegram_topics.js";
import { migration as orderCards } from "./0031_order_cards.js";
import { migration as fillNotices } from "./0032_fill_notices.js";
import { migration as modelBudget } from "./0033_model_budget.js";
import { migration as intentAssets } from "./0034_intent_assets.js";
import { migration as questions } from "./0035_questions.js";
import { migration as ownerAgent } from "./0036_owner_agent.js";
import { migration as cardAutoAsks } from "./0037_card_auto_asks.js";
import { migration as walletRoles } from "./0038_wallet_roles.js";
import { migration as extraLaunchWallets } from "./0039_extra_launch_wallets.js";
import { migration as scheduleRuns } from "./0040_schedule_runs.js";
import { migration as alertFires } from "./0041_alert_fires.js";
import { migration as trackedWallets } from "./0042_tracked_wallets.js";
import { migration as overflowNotices } from "./0043_overflow_notices.js";
import { migration as launches } from "./0044_launches.js";

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
  telegramOwner,
  lateLandings,
  webPushSubscriptions,
  tokenExpiry,
  miniAppLaunches,
  miniAppTickets,
  carriedOutflows,
  backupDigests,
  sealKey,
  agentInbox,
  cardPlaces,
  telegramTopics,
  orderCards,
  fillNotices,
  modelBudget,
  intentAssets,
  questions,
  ownerAgent,
  cardAutoAsks,
  walletRoles,
  extraLaunchWallets,
  scheduleRuns,
  alertFires,
  trackedWallets,
  overflowNotices,
  launches,
];
