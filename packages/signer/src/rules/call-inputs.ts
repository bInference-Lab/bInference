import { accountRefParts, type CallInputCheck } from "@binference/chain";
import { type CallHeads, readHeads, wordAt } from "./abi-heads.schema.js";
import { callSelectorOf } from "./call-selector.schema.js";
import type { RuleView } from "./hard-rule.js";

const selectorChars = 8;
const addressPadding = "0".repeat(24);
function addressOf(word: string | undefined): string | undefined {
  return word?.startsWith(addressPadding) === true ? `0x${word.slice(24)}` : undefined;
}

function numberOf(word: string | undefined): bigint | undefined {
  return word === undefined ? undefined : BigInt(`0x${word}`);
}

// The length of a dynamic `bytes` input, read where its head word points.
function lengthOf(call: CallHeads, name: string): bigint | undefined {
  const offset = numberOf(call.words.get(name));
  if (offset === undefined || call.types.get(name) !== "bytes") {
    return undefined;
  }
  return numberOf(wordAt(call.body, offset));
}

function equals(call: CallHeads, name: string, expected: string): boolean {
  const word = call.words.get(name);
  return expected.startsWith("0x")
    ? call.types.get(name) === "address" && addressOf(word) === expected.toLowerCase()
    : numberOf(word) === BigInt(expected);
}

// A bridge deposit's check names its recipient and destination chain from the confirmed plan, and
// its least output on the input the venue declares a fill pays at least, never on another; one
// that does not refuses the call (decisions 0302 and 0317).
function isBound(check: CallInputCheck): boolean {
  const { bridge } = check;
  return (
    bridge === undefined ||
    (check.equal[bridge.recipient] !== undefined &&
      check.equal[bridge.destinationChain] !== undefined &&
      check.atLeast[bridge.minOut] !== undefined)
  );
}

function targetsHold(call: CallHeads, check: CallInputCheck, wallet: string): boolean {
  const pinned = check.wallet.every(
    (name) => call.types.get(name) === "address" && addressOf(call.words.get(name)) === wallet,
  );
  const equal = Object.entries(check.equal).every(([name, value]) => equals(call, name, value));
  const empty = check.empty.every((name) => lengthOf(call, name) === 0n);
  return pinned && equal && empty && isBound(check);
}

function amountsHold(call: CallHeads, check: CallInputCheck): boolean {
  return Object.entries(check.atLeast).every(([name, least]) => {
    const value = numberOf(call.words.get(name));
    return (
      /^uint\d{0,3}$/.test(call.types.get(name) ?? "") &&
      value !== undefined &&
      value >= BigInt(least)
    );
  });
}

/**
 * Whether a call's inputs keep every check of `allowed.callInputs` whose function it calls
 * (decision 0302): `who` its pinned, equal and empty inputs, and a bridge deposit's recipient,
 * chain and least output named, as rule 2 reads them; `amounts` its
 * least amounts, as rule 3 does. A check whose selector cannot be read, or whose inputs the
 * calldata cannot hold, breaks `who`, so rule 2 fails closed. A call no check names keeps them.
 */
export function callInputsHold(view: RuleView, part: "who" | "amounts"): boolean {
  const { data } = view.transaction;
  const selector = data.slice(2, 2 + selectorChars);
  const wallet = accountRefParts(view.input.wallet.account).address.toLowerCase();
  return (view.input.allowed.callInputs ?? []).every((check) => {
    const named = callSelectorOf(check.abi);
    if (named !== undefined && named !== selector) {
      return true;
    }
    // An unreadable check or call breaks rule 2 alone, which refuses it.
    const call = named === undefined ? undefined : readHeads(check.abi, data);
    if (call === undefined) {
      return part === "amounts";
    }
    return part === "who" ? targetsHold(call, check, wallet) : amountsHold(call, check);
  });
}
