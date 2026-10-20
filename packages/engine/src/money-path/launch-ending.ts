import { cardRulesOf } from "../agents/card-rules-of.js";
import type { IntentSnapshot } from "../intents/create-stored-intents.js";
import { requestDocument } from "../intents/intent-documents.schema.js";
import type { IntentRecord } from "../intents/intent-record.js";
import { type TokenLaunchQuote, tokenLaunchQuoteDocument } from "../intents/token-launch-quote.js";
import { noticePush } from "../pushes/notice-push.js";
import type { LaunchPathOptions } from "./resolve-launch.js";

// The owner's notice of a launch that stopped once its upload began (decisions 0234, 0237).
const launchStoppedNoticeKey = "notice.launchStopped";

// The pin wait of decision 0234: 5 minutes after the upload.
const defaultPinWaitMs = 300_000;

/** How long a launch waits for its pin after its upload. */
export function pinWaitOf(options: Pick<LaunchPathOptions, "launch">): number {
  return options.launch.pinWaitMs ?? defaultPinWaitMs;
}

/**
 * Why a launch stopped once its upload began, as the owner's notice says it: a check reason it
 * ended `failed_check` with, or `engine_stopping` for one a stop left too long before its card.
 */
type LaunchStop = NonNullable<IntentRecord["reason"]> | "engine_stopping";

// Nothing of the launch went public (decision 0276): its quote holds no pin, or, before a quote,
// its launchpad is one the engine holds that uploads nothing. A launchpad it no longer holds may
// hold the picture and words.
function isUnpublished(
  options: Pick<LaunchPathOptions, "launch">,
  stopped: { readonly record: IntentRecord; readonly venue: string },
): boolean {
  const { quote } = stopped.record;
  return quote === undefined
    ? options.launch.host.takesUpload(stopped.venue) === false
    : tokenLaunchQuoteDocument.decode(quote).pin === undefined;
}

/**
 * Tells the owner that a launch stopped once its upload began, and why: nothing was signed, and
 * its picture and words may be public on the launchpad (decision 0237), unless the launchpad
 * uploads nothing (decision 0276).
 */
function tellLaunchStopped(
  options: Pick<LaunchPathOptions, "launch">,
  record: IntentRecord,
  reason: LaunchStop,
): void {
  const request = requestDocument.decode(record.request);
  const symbol = request.kind === "launchToken" ? request.symbol : "";
  const venue = request.kind === "launchToken" ? request.venue : "";
  const isPrivate = isUnpublished(options, { record, venue });
  const values = { symbol, venue, reason, private: isPrivate ? "yes" : "no" };
  options.launch.publish(
    noticePush({ key: launchStoppedNoticeKey, agent: record.agentId, intent: record.id, values }),
  );
}

/**
 * Tells the owner when a launch whose upload began ended unsigned, `failed_check` or `cancelled`,
 * and answers it as it is.
 */
export function toldIfEnded(
  options: Pick<LaunchPathOptions, "launch">,
  ended: IntentSnapshot,
): IntentSnapshot {
  const { record } = ended;
  if (record.state === "failed_check" && record.reason !== undefined) {
    tellLaunchStopped(options, record, record.reason);
  }
  if (record.state === "cancelled") {
    tellLaunchStopped(options, record, "engine_stopping");
  }
  return ended;
}

/**
 * Whether a launch a stop left between its pin and its card is too old to show (decision 0237):
 * its pin wait and a card's life have both passed, so its card would open on a plan and a fee
 * built long before.
 */
export function isLaunchStale(
  snapshot: IntentSnapshot,
  quote: TokenLaunchQuote,
  nowMs: number,
): boolean {
  return nowMs >= quote.pinWaitUntilMs + cardRulesOf(snapshot.settings.limits).otherExpiryMs;
}
