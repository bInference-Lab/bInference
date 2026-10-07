import { jsonValueSchema } from "@binference/core";
import type { IntentChange, IntentCommit } from "../intents/intent-change.js";
import { ledgerEntryViewOf } from "../ledger/ledger-entry-view.js";
import type { EnginePush } from "./engine-push.js";

function intentPush(commit: IntentCommit, kind: "intent/created" | "intent/changed"): EnginePush {
  const { intent } = commit;
  const data = {
    intent: intent.id,
    agent: intent.agentId,
    state: intent.state,
    version: intent.version,
    changedAt: intent.changedAtMs,
  };
  return { topic: "intent", kind, data };
}

function cardPushes(commit: IntentCommit, change: IntentChange): readonly EnginePush[] {
  const intent = commit.intent.id;
  const { openCard, closeCard } = change;
  const closed: readonly EnginePush[] =
    closeCard === undefined
      ? []
      : [
          {
            topic: "intent",
            kind: "card/closed",
            data: { intent, card: closeCard.id, reason: closeCard.reason },
          },
        ];
  const opened: readonly EnginePush[] =
    openCard === undefined
      ? []
      : [
          {
            topic: "intent",
            kind: "card/opened",
            data: {
              intent,
              card: openCard.id,
              version: openCard.version,
              opensAt: openCard.openedAtMs,
              expiresAt: openCard.expiresAtMs,
            },
          },
        ];
  return [...closed, ...opened];
}

function ledgerPushes(commit: IntentCommit): readonly EnginePush[] {
  const entry = commit.ledgerEntry;
  return entry === undefined
    ? []
    : [
        {
          topic: "ledger",
          kind: "ledger/appended",
          data: jsonValueSchema.parse(ledgerEntryViewOf(entry)),
        },
      ];
}

/**
 * The pushes one stored write of an intent sends (protocol spec, section 6; spec 6, section 8):
 * `intent/created` for a new intent and `intent/changed` for every move, `card/closed` and
 * `card/opened` for the card versions the move closed and opened, and `ledger/appended` for its
 * ledger entry. Pass the change for a move; a new intent has none.
 */
export function intentPushes(commit: IntentCommit, change?: IntentChange): readonly EnginePush[] {
  if (change === undefined) {
    return [intentPush(commit, "intent/created"), ...ledgerPushes(commit)];
  }
  return [
    intentPush(commit, "intent/changed"),
    ...cardPushes(commit, change),
    ...ledgerPushes(commit),
  ];
}
