import type { Amount } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText, type Formatter } from "@binference/i18n";
import { type CardView, type IntentView, operations, type ProtocolId } from "@binference/protocol";
import { z } from "zod";
import type { CommonOptions } from "../program/cli-flags.schema.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
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

function reportConfirmed(run: CommandRun, view: IntentView): ExitCode {
  const { output, formatter } = run;
  printView(output, view);
  if (view.state === "awaiting_confirmation" && view.card !== undefined) {
    return reportReopened(run, view, view.card);
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

/**
 * `binference confirm <intent>` and `binference deny <intent>`: answer the intent's newest card
 * version from the terminal, as its Confirm or Cancel button does, through `intent/confirm` with
 * that version or `intent/deny`. A confirmed paper intent shows its paper fill; a worse re-quote
 * opens the next card version and exits 1 with its terms, to be checked and confirmed again. An
 * intent with no card, an expired or answered card, or a card that changed is refused with the
 * engine's code. With `--json` it prints the intent after the answer.
 */
export async function runCardAnswer(
  run: CommandRun,
  request: CardAnswerRequest,
): Promise<ExitCode> {
  const { host, output } = run;
  return withEngine(host, output, async (client, signal) => {
    const { intent } = request;
    const { card } = await client.call("intent/get", { intent }, { signal });
    if (card === undefined) {
      output.refuse("intent.wrong_state");
      return 1;
    }
    if (request.name === "deny") {
      const denied = await client.call("intent/deny", { intent, card: card.card }, { signal });
      printView(output, denied);
      output.say("deny.done", { intent });
      return 0;
    }
    const args = { intent, card: card.card, cardVersion: card.version };
    return reportConfirmed(run, await client.call("intent/confirm", args, { signal }));
  });
}
