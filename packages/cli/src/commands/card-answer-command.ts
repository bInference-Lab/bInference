import type { Amount } from "@binference/chain";
import type { ProtocolClient } from "@binference/client";
import { jsonValueSchema } from "@binference/core";
import {
  cardLineText,
  displayOutsideText,
  type Formatter,
  reasonNamesOf,
  unsentReceiptText,
} from "@binference/i18n";
import {
  type AutoOrderRequest,
  type CardLinesView,
  type CardView,
  type IntentView,
  operations,
  type OrderView,
  type ProtocolId,
  type UnfreezeRequest,
  unsentEndStates,
  type WebhookRuleCardRequest,
  type WebhookRuleView,
} from "@binference/protocol";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { CliOutput, ExitCode, StepOutcome } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import type { Prompter } from "../term/prompter.js";
import { withEngine } from "./connect-engine.js";

/** What `binference confirm` or `binference deny` was asked: the answer and the intent. */
export interface CardAnswerRequest {
  readonly name: "confirm" | "deny";
  readonly options: CommonOptions;
  readonly intent: ProtocolId<"intent">;
}

/** The request of an intent whose confirmation sends nothing on chain. */
type Written =
  | UnfreezeRequest
  | AutoOrderRequest
  | WebhookRuleCardRequest
  | Extract<IntentView["request"], { readonly kind: "configChange" }>;

/**
 * Where the auto order or alert rule a confirmed card started stands after the tap: its state,
 * `ended` for a rule no longer listed, or `unread`.
 */
type StartedState = OrderView["state"] | WebhookRuleView["state"] | "ended" | "unread";

// As a card shows a token's symbol: set by whoever deployed the token, so cut and made visible.
const symbolLength = 16;

function amountText(formatter: Formatter, view: IntentView, amount: Amount): string {
  const info = view.assets[amount.asset];
  return info === undefined
    ? `${String(amount.base)} ${amount.asset}`
    : `${formatter.tokenAmount(amount.base, info.decimals)} ${displayOutsideText(info.symbol, symbolLength)}`;
}

function printView(output: CliOutput, view: IntentView): void {
  output.json(jsonValueSchema.parse(z.encode(operations["intent/get"].result, view)));
}

// A worse re-quote opened the next card version instead of confirming: the owner checks it first.
function reportReopened(run: CommandRun, view: IntentView, card: CardView): ExitCode {
  const { quote } = view;
  run.output.explain("confirm.reopened", {
    intent: view.intent,
    version: card.version,
    sold: quote === undefined ? "" : amountText(run.formatter, view, quote.amountIn),
    bought: quote === undefined ? "" : amountText(run.formatter, view, quote.minOut),
  });
  return 1;
}

// An unfreeze took effect at the tap: it names one agent, or every frozen agent and the install.
function reportUnfrozen(
  output: CliOutput,
  intent: ProtocolId<"intent">,
  agent: ProtocolId<"agent"> | undefined,
): ExitCode {
  const scope = agent === undefined ? "install" : "agent";
  output.say("confirm.unfrozen", { intent, scope, agent: agent ?? "" });
  return 0;
}

// What a confirmed card that sends nothing took effect as: an unfreeze, or the auto order or
// alert rule its card confirmed, in the state it stands in after the tap.
function reportWritten(
  output: CliOutput,
  view: { readonly intent: ProtocolId<"intent">; readonly request: Written },
  started: StartedState,
): ExitCode {
  const { intent, request } = view;
  if (request.kind === "unfreeze") {
    return reportUnfrozen(output, intent, request.agent);
  }
  if (request.kind === "configChange") {
    output.say("confirm.configChanged", { intent });
    return 0;
  }
  const key = request.kind === "autoOrder" ? "confirm.order" : "confirm.webhookRule";
  output.say(key, { intent, state: started });
  return 0;
}

// The state of the auto order or alert rule a confirmed card started, read after the tap: a rule
// the list no longer holds ended before it, and a failed read leaves the state unsaid.
async function startedStateOf(
  client: ProtocolClient,
  request: IntentView["request"],
  signal: AbortSignal,
): Promise<StartedState> {
  if (request.kind === "autoOrder") {
    const order = client.call("order/get", { order: request.order }, { signal });
    return order.then(
      ({ state }) => state,
      () => "unread",
    );
  }
  if (request.kind !== "webhookRule") {
    return "unread";
  }
  const rules = client.call("webhookRule/list", {}, { signal });
  return rules.then(
    ({ items }) => items.find(({ rule }) => rule === request.rule)?.state ?? "ended",
    () => "unread",
  );
}

// A confirmed intent that will send or fill nothing: why it ended before, on standard error with
// exit 1, or what it took effect as; `undefined` for one still on its way.
function reportEnded(
  run: CommandRun,
  view: IntentView,
  started: StartedState,
): ExitCode | undefined {
  const { intent, request } = view;
  if (unsentEndStates.has(view.state)) {
    const receipt = unsentReceiptText(run.formatter, view.outcome?.reason, reasonNamesOf(view));
    run.output.explain("confirm.unsent", { intent, receipt });
    return 1;
  }
  const isWritten =
    request.kind === "unfreeze" ||
    request.kind === "autoOrder" ||
    request.kind === "webhookRule" ||
    request.kind === "configChange";
  return isWritten ? reportWritten(run.output, { intent, request }, started) : undefined;
}

function reportConfirmed(run: CommandRun, view: IntentView, started: StartedState): ExitCode {
  const { output, formatter } = run;
  printView(output, view);
  if (view.state === "awaiting_confirmation" && view.card !== undefined) {
    return reportReopened(run, view, view.card);
  }
  const ended = reportEnded(run, view, started);
  if (ended !== undefined) {
    return ended;
  }
  const [fill] = view.outcome?.executions ?? [];
  if (view.paper && fill !== undefined) {
    output.say("confirm.paperFilled", {
      intent: view.intent,
      sold: amountText(formatter, view, fill.amountIn),
      bought: amountText(formatter, view, fill.amountOut),
    });
    return 0;
  }
  output.say(view.paper ? "confirm.paperWaiting" : "confirm.sending", { intent: view.intent });
  return 0;
}

// The words that answer yes or no: the owner's language's and English, in any case.
function wordsOf(run: CommandRun, key: "confirm.yes" | "confirm.no"): readonly string[] {
  const english = key === "confirm.yes" ? ["yes", "y"] : ["no", "n"];
  return [run.formatter.message(`cli.${key}`).toLowerCase(), ...english];
}

function words(answer: string): string {
  return answer.trim().toLowerCase();
}

// Asks whether to confirm the card shown; a word that is neither yes nor no asks again.
async function isConfirmed(run: CommandRun, prompter: Prompter): Promise<boolean> {
  const [yes, no] = [wordsOf(run, "confirm.yes"), wordsOf(run, "confirm.no")];
  const answer = await prompter.ask({
    id: "confirm",
    message: run.formatter.message("cli.confirm.ask"),
    check: (typed) =>
      [...yes, ...no].includes(words(typed))
        ? undefined
        : run.formatter.message("cli.confirm.yesOrNo"),
  });
  return yes.includes(words(answer));
}

// The intent's open card version as the engine draws it; the exit code after a refusal.
async function drawnCard(
  run: CommandRun,
  intent: ProtocolId<"intent">,
): Promise<StepOutcome<CardLinesView>> {
  const drawn: { card?: CardLinesView } = {};
  const code = await withEngine(run.host, run.output, async (client, signal) => {
    drawn.card = await client.call("intent/card", { intent }, { signal });
    return 0;
  });
  return drawn.card === undefined ? { ok: false, code } : { ok: true, value: drawn.card };
}

// The card as its buttons' surface shows it, one line each, in the owner's language.
function printCard(run: CommandRun, card: CardLinesView): void {
  const display = { formatter: run.formatter, assets: card.assets };
  for (const line of card.lines) {
    run.output.line(cardLineText(line, display));
  }
}

async function deny(run: CommandRun, intent: ProtocolId<"intent">): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { card } = await client.call("intent/get", { intent }, { signal });
    if (card === undefined) {
      output.refuse("intent.wrong_state");
      return 1;
    }
    const denied = await client.call("intent/deny", { intent, card: card.card }, { signal });
    printView(output, denied);
    output.say("deny.done", { intent });
    return 0;
  });
}

async function confirm(run: CommandRun, request: CardAnswerRequest): Promise<ExitCode> {
  const { intent, options } = request;
  const { prompter } = run.host;
  if (!options.yes && (prompter === undefined || options.json)) {
    const failure = { code: "cli.confirm_needs_terminal", key: "confirm.needsTerminal" };
    run.output.fail({ ...failure, values: { intent } });
    return 1;
  }
  const drawn = await drawnCard(run, intent);
  if (!drawn.ok) {
    return drawn.code;
  }
  printCard(run, drawn.value);
  if (!options.yes && prompter !== undefined && !(await isConfirmed(run, prompter))) {
    run.output.say("confirm.notConfirmed", { intent });
    return 1;
  }
  const { card, version } = drawn.value;
  return withEngine(run.host, run.output, async (client, signal) => {
    const args = { intent, card, cardVersion: version };
    const view = await client.call("intent/confirm", args, { signal });
    return reportConfirmed(run, view, await startedStateOf(client, view.request, signal));
  });
}

/**
 * `binference confirm <intent>` and `binference deny <intent>`: answer the intent's newest card
 * version from the terminal, as its Confirm or Cancel button does. Confirm shows the card first,
 * line by line as the engine draws it through `intent/card`, and asks yes or no unless `--yes`
 * says yes before; without `--yes` it needs someone at the terminal, so `--json` alone is
 * refused. It then confirms that version through `intent/confirm`; a confirmed paper intent shows
 * its paper fill, a confirmed unfreeze what it unfroze, an auto order's card whether its order
 * became active, read through `order/get`, and an alert rule's card whether its rule did, read
 * through `webhookRule/list`; one that ended before it sent or filled, such as a paper
 * sale its holding no longer covers, says why on standard error and exits 1; a worse re-quote
 * opens the next card
 * version and exits 1 with its terms, to be checked and confirmed again. Deny cancels through
 * `intent/deny` at once. An intent with no open card, or a card that changed, is refused with the
 * engine's code. With `--json` it prints the intent after the answer.
 */
export async function runCardAnswer(
  run: CommandRun,
  request: CardAnswerRequest,
): Promise<ExitCode> {
  return request.name === "deny" ? deny(run, request.intent) : confirm(run, request);
}
