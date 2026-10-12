import type { IntentState } from "../views/intent-state.schema.js";
import type { IntentView } from "../views/intent-view.schema.js";

/**
 * The sentences a model reads in more than one tool's text, for the agent's tools and the MCP
 * server's alike. They stay English: a model reads them.
 */
export interface ToolSentences {
  /** How amounts are written. */
  readonly units: string;
  /** How tokens and addresses are named. */
  readonly ids: string;
  /** That a proposal waits for the owner's tap. */
  readonly waits: string;
}

/** The shared sentences of tool texts. */
export const toolSentences: ToolSentences = {
  units:
    "Amounts are base units as decimal strings; USD values are micro-dollars as decimal strings.",
  ids: "Tokens are CAIP-19 asset ids and addresses are CAIP-10 account ids.",
  waits:
    "Nothing moves until the owner confirms the card in Telegram or the console; no tool can confirm.",
};

// The states before the owner's tap: the engine still checks the intent, or its card is open.
const waitingStates: ReadonlySet<IntentState> = new Set<IntentState>([
  "proposed",
  "checked",
  "quoted",
  "assessed",
  "simulated",
  "awaiting_confirmation",
]);

const waitingText = "is waiting for the owner's confirmation in Telegram or the console.";

/**
 * The sentence a proposal answers with: the intent's id and, while it waits for the owner's tap,
 * that it waits for the owner's confirmation in Telegram or the console. Any other intent, such as
 * one the engine refused by policy or risk, names its state and its reason.
 */
export function proposalAnswer(intent: Pick<IntentView, "intent" | "state" | "outcome">): string {
  if (waitingStates.has(intent.state)) {
    return `Intent ${intent.intent} ${waitingText}`;
  }
  const reason = intent.outcome?.reason;
  const why = reason === undefined ? "" : ` with reason ${reason}`;
  return `Intent ${intent.intent} is in state ${intent.state}${why}.`;
}
