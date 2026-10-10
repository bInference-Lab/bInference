import type { Amount } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { cardLineText } from "@binference/engine/surfaces";
import { displayOutsideText, type Formatter } from "@binference/i18n";
import {
  type CardLinesView,
  type CardView,
  type IntentView,
  operations,
  type ProtocolId,
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

function reportConfirmed(run: CommandRun, view: IntentView): ExitCode {
  const { output, formatter } = run;
  printView(output, view);
  if (view.state === "awaiting_confirmation" && view.card !== undefined) {
    return reportReopened(run, view, view.card);
  }
  if (view.request.kind === "unfreeze") {
    return reportUnfrozen(output, view.intent, view.request.agent);
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
    return reportConfirmed(run, await client.call("intent/confirm", args, { signal }));
  });
}

/**
 * `binference confirm <intent>` and `binference deny <intent>`: answer the intent's newest card
 * version from the terminal, as its Confirm or Cancel button does. Confirm shows the card first,
 * line by line as the engine draws it through `intent/card`, and asks yes or no unless `--yes`
 * says yes before; without `--yes` it needs someone at the terminal, so `--json` alone is
 * refused. It then confirms that version through `intent/confirm`; a confirmed paper intent shows
 * its paper fill, and a confirmed unfreeze what it unfroze; a worse re-quote opens the next card
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
