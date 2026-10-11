import type { JsonValue } from "@binference/core";
import type { RecordedCall } from "./mcp-recorder.js";
import type { SkillRunIds } from "./skill-run-engine.js";

/** Whether the recorded run proposed the swap the owner asked for, and what it got wrong. */
export interface SkillRunVerdict {
  readonly passed: boolean;
  /** One sentence for each thing the run got wrong; none when it passed. */
  readonly problems: readonly string[];
}

type Arguments = RecordedCall["arguments"];

// 0.01 BNB in base units: BNB has 18 decimals.
const swapBase = "10000000000000000";
// The owner named no slippage, so a proposal may leave it out or ask at most the agent's limit
// for a token the registry lists.
const maxSlippageBps = 50;
const waiting = "is waiting for the owner's confirmation";
// Proposals the owner did not ask for: an auto order or an alert instead of the swap.
const otherProposals = new Set(["binference_order_create", "binference_alert_create"]);

function text(value: JsonValue | undefined): string {
  return value === undefined ? "nothing" : JSON.stringify(value);
}

function fieldProblems(args: Arguments, ids: SkillRunIds): readonly string[] {
  const expected: readonly (readonly [string, JsonValue])[] = [
    ["kind", "swap"],
    ["agent", ids.agent],
    ["from", ids.bnb],
    ["to", ids.usdt],
    ["amount", { base: swapBase }],
  ];
  return expected
    .filter(([name, value]) => text(args[name]) !== text(value))
    .map(([name, value]) => `${name} was ${text(args[name])}, not ${text(value)}.`);
}

function slippageOk(slippage: JsonValue | undefined): boolean {
  return (
    slippage === undefined ||
    (typeof slippage === "number" &&
      Number.isInteger(slippage) &&
      slippage > 0 &&
      slippage <= maxSlippageBps)
  );
}

function optionalProblems(args: Arguments, ids: SkillRunIds): readonly string[] {
  const { wallet, maxSlippageBps: slippage, reason, requestId } = args;
  return [
    ...(wallet === undefined || wallet === ids.wallet
      ? []
      : [`wallet was ${text(wallet)}, not absent or ${ids.wallet}.`]),
    ...(slippageOk(slippage)
      ? []
      : [`maxSlippageBps was ${text(slippage)}, not absent or 1 to 50.`]),
    ...(typeof reason === "string" && reason.trim() !== "" ? [] : ["reason was empty."]),
    ...(requestId === undefined || typeof requestId === "string"
      ? []
      : [`requestId was ${text(requestId)}, not a string.`]),
  ];
}

function answerProblems(call: RecordedCall): readonly string[] {
  const first = call.answer?.texts[0];
  if (call.answer === undefined) {
    return ["The proposal got no answer before the run ended."];
  }
  return !call.answer.isError && first?.includes(waiting) === true
    ? []
    : [`The engine answered the proposal with: ${call.answer.texts.join(" ")}`];
}

// Retries of one proposal share its request id; each proposal without one counts on its own.
function proposalCount(proposals: readonly RecordedCall[]): number {
  const keys = proposals.map((call, index) => {
    const { requestId } = call.arguments;
    return typeof requestId === "string" ? requestId : `#${String(index)}`;
  });
  return new Set(keys).size;
}

/**
 * Judges the recorded run of "swap 0.01 BNB to USDT": exactly one proposal, a swap of 0.01 BNB in
 * base units from the agent's BNB to its USDT by their ids, with no slippage above the agent's
 * limit, which the engine answered as waiting for the owner's confirmation, and no other kind of
 * proposal.
 */
export function skillRunVerdict(calls: readonly RecordedCall[], ids: SkillRunIds): SkillRunVerdict {
  const proposals = calls.filter((call) => call.tool === "binference_propose");
  const last = proposals.at(-1);
  const count = proposalCount(proposals);
  const problems = [
    ...calls
      .filter((call) => otherProposals.has(call.tool))
      .map((call) => `It called ${call.tool}, which the owner did not ask for.`),
    ...(count > 1 ? [`It proposed ${String(count)} times; the owner asked for one swap.`] : []),
    ...(last === undefined
      ? ["It never called binference_propose."]
      : [
          ...fieldProblems(last.arguments, ids),
          ...optionalProblems(last.arguments, ids),
          ...answerProblems(last),
        ]),
  ];
  return { passed: problems.length === 0, problems };
}
