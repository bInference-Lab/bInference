import type { AddressBookHandlers } from "../address-book/address-book-handlers.js";
import type { ApprovalHandlers } from "../approval/approval-handlers.js";
import type { ConfigHistoryHandlers } from "../audit/config-history-handlers.js";
import type { IdentityHandlers } from "../identity/identity-handlers.js";
import type { LimitHandlers } from "../limits/limit-handlers.js";
import type { NameHandlers } from "../names/name-handlers.js";
import type { OrderHandlers } from "../orders/order-handlers.js";
import type { RescueAddressHandlers } from "../safety/rescue-address-handlers.js";
import type { SafetyHandlers } from "../safety/safety-handlers.js";
import type { SendLevelHandlers } from "../send-levels/send-level-handlers.js";
import type { ShellHandlers } from "../shell/shell-handlers.js";
import type { WebhookRuleHandlers } from "../webhooks/webhook-rule-handlers.js";
import type { LaunchDraftHandlers } from "./engine-launch-drafts.js";
import type { EngineChatHandlers } from "./engine-parts.js";
import type { IntentHandlers } from "./intent-handlers.js";
import type { LedgerHandlers } from "./ledger-handlers.js";
import type { SettingsHandlers } from "./settings-handlers.js";

/** The operation handlers the engine gives the protocol server, by operation name. */
export interface EngineHandlers
  extends
    EngineChatHandlers,
    IntentHandlers,
    OrderHandlers,
    LedgerHandlers,
    ConfigHistoryHandlers,
    SettingsHandlers,
    ApprovalHandlers,
    LimitHandlers,
    SendLevelHandlers,
    AddressBookHandlers,
    RescueAddressHandlers,
    SafetyHandlers,
    LaunchDraftHandlers,
    NameHandlers,
    IdentityHandlers,
    WebhookRuleHandlers,
    ShellHandlers {}
