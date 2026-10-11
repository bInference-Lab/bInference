import { accountRefParts, type ChainRef } from "@binference/chain";
import { jsonValueSchema } from "@binference/core";
import { displayOutsideText } from "@binference/i18n";
import {
  type CeilingChanges,
  type CeilingView,
  operations,
  type WalletView,
} from "@binference/protocol";
import { z } from "zod";
import { selfHostedChains } from "../compose/open-engine-parts.js";
import { baseUnitsOf } from "../init/base-units.js";
import type { CeilingSetFlags, WalletAddressFlags } from "../program/cli-flags.schema.js";
import type { ExitCode, StepOutcome } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { chainName } from "./chain-name.js";
import { printDayCaps } from "./day-cap-lines.js";
import { cannotAskOwnerKey, withOwnerKey } from "./owner-key-prompt.js";
import { withWallet } from "./wallet-choice.js";

// A label is the owner's text from any surface: cut and made visible, as cards do.
const labelLength = 64;

// The native coin of the ceiling's first chain, when this binference serves that chain.
function nativeOf(ceiling: CeilingView) {
  const [chain] = ceiling.chains;
  const served = chain === undefined ? undefined : selfHostedChains().get(chain);
  return served?.ok === true ? served.value.definition.nativeAsset : undefined;
}

// The cap in the native coin of the ceiling's first chain when this binference serves it, such as
// 1 BNB; else in base units.
function printCap(run: CommandRun, ceiling: CeilingView): void {
  const native = nativeOf(ceiling);
  if (native !== undefined) {
    const { decimals, symbol } = native;
    const amount = run.formatter.tokenAmount(ceiling.perTxNative, decimals);
    run.output.say("ceiling.cap", { amount, symbol });
    return;
  }
  run.output.say("ceiling.capBase", { amount: String(ceiling.perTxNative) });
}

function printRecipients(run: CommandRun, ceiling: CeilingView): void {
  run.output.say("ceiling.recipients", { count: ceiling.recipients.length });
  for (const account of ceiling.recipients) {
    const { chain, address } = accountRefParts(account);
    run.output.item("ceiling.recipient", { address, chain: chainName(chain) });
  }
}

function namesOf(chains: readonly ChainRef[]): string {
  return chains.map(chainName).join(", ");
}

// The ceiling as the operation answers it with `--json`, else line by line under its heading.
function printCeiling(
  run: CommandRun,
  shown: { readonly wallet: WalletView; readonly ceiling: CeilingView },
): void {
  const { output, formatter } = run;
  const { wallet, ceiling } = shown;
  output.json(jsonValueSchema.parse(z.encode(operations["ceiling/get"].result, ceiling)));
  output.say("ceiling.heading", {
    label: displayOutsideText(wallet.label, labelLength),
    wallet: wallet.wallet,
    readAt: formatter.dateTime(ceiling.readAt),
  });
  output.item("ceiling.chains", { chains: namesOf(ceiling.chains) });
  output.item("ceiling.venues", {
    count: ceiling.venues.length,
    venues: ceiling.venues.join(", "),
  });
  printCap(run, ceiling);
  printRecipients(run, ceiling);
  printDayCaps(run, ceiling);
}

/**
 * `binference ceiling [--agent <id>] [--wallet <id>]`: the ceiling of the agent's default wallet,
 * or of the wallet `--wallet` names, as custody holds it now, through `ceiling/get`: the chains it
 * enables, the venues a call may reach, the most native coin one contract call may carry, every
 * address a send may pay, and the 24-hour caps every wallet shares. Only the owner key changes a ceiling. With `--json` it prints the
 * ceiling as the operation answers it.
 */
export async function runCeiling(
  run: CommandRun,
  request: { readonly options: WalletAddressFlags },
): Promise<ExitCode> {
  return withWallet(run, request.options, async (wallet, client, signal) => {
    const ceiling = await client.call("ceiling/get", { wallet: wallet.wallet }, { signal });
    printCeiling(run, { wallet, ceiling });
    return 0;
  });
}

/** What `ceiling set` asks for: the wallet it names, and the changes in the engine's units. */
interface CeilingPlan {
  readonly wallet: WalletView;
  readonly changes: CeilingChanges;
}

// Dollars carry six decimals as micro-dollars, as the protocol's USD values do.
const usdDecimals = 6;

// The changes the flags ask for, the cap in base units of the ceiling's native coin and the
// 24-hour caps in micro-dollars; undefined for a cap that is no amount of it.
function changesOf(options: CeilingSetFlags, ceiling: CeilingView): CeilingChanges | undefined {
  const { venues, perTx, dayCapUsd } = options;
  if (dayCapUsd !== undefined) {
    return { dayCapUsdMicros: baseUnitsOf(dayCapUsd, usdDecimals) ?? 0n };
  }
  const native = nativeOf(ceiling);
  const cap =
    perTx === undefined || native === undefined ? undefined : baseUnitsOf(perTx, native.decimals);
  if (perTx !== undefined && cap === undefined) {
    return undefined;
  }
  return {
    ...(venues === undefined ? {} : { venues }),
    ...(cap === undefined ? {} : { perTxNative: cap }),
  };
}

// The wallet `--agent` or `--wallet` names and the changes for its ceiling, read before the owner
// key is asked for; the exit code after a refusal it printed.
async function planOf(
  run: CommandRun,
  options: CeilingSetFlags,
): Promise<StepOutcome<CeilingPlan>> {
  const planned: { plan?: CeilingPlan } = {};
  const code = await withWallet(run, options, async (wallet, client, signal) => {
    const ceiling = await client.call("ceiling/get", { wallet: wallet.wallet }, { signal });
    const changes = changesOf(options, ceiling);
    if (changes === undefined) {
      const values = { amount: options.perTx ?? "" };
      run.output.fail({ code: "protocol.bad_args", key: "ceiling.badCap", values });
      return 1;
    }
    planned.plan = { wallet, changes };
    return 0;
  });
  return planned.plan === undefined ? { ok: false, code } : { ok: true, value: planned.plan };
}

// Nothing to change; 24-hour caps with another change, as they reach every wallet of the install;
// or caps that are no dollar amount above 0.
function flagsRefusal(
  options: CeilingSetFlags,
): { readonly key: string; readonly values?: Readonly<Record<string, string>> } | undefined {
  const { venues, perTx, dayCapUsd } = options;
  if (dayCapUsd === undefined) {
    return venues === undefined && perTx === undefined
      ? { key: "ceiling.nothingToSet" }
      : undefined;
  }
  if (venues !== undefined || perTx !== undefined) {
    return { key: "ceiling.dayCapsAlone" };
  }
  const micros = baseUnitsOf(dayCapUsd, usdDecimals);
  return micros === undefined || micros === 0n
    ? { key: "ceiling.badDayCap", values: { amount: dayCapUsd } }
    : undefined;
}

/**
 * `binference ceiling set [--agent <id>] [--wallet <id>] [--venues <ids>] [--per-tx <amount>]
 * [--day-cap-usd <dollars>]`:
 * changes, with the owner key the person types unseen, the ceiling of every wallet of the agent
 * through `ceiling/set` (decision 0132): `--venues` the venues a contract call may use, each
 * separated by a comma, and `--per-tx` the most native coin one call may carry, as `perTxBnb` in
 * config. `--day-cap-usd` sizes every 24-hour cap at that many dollars at its floor price, on the
 * ceiling of every live wallet of the install, which share the caps (decision 0151); it comes
 * alone. The chains stay. Every surface announces the change. It prints the named wallet's
 * ceiling afterwards, or the agent's default wallet's. With `--yes`, `--json` or nobody at the
 * terminal it reads nothing, as the owner key needs a terminal. Exits 1 when it names nothing to
 * change, caps with another change, or a cap that is no amount.
 */
export async function runCeilingSet(
  run: CommandRun,
  request: { readonly options: CeilingSetFlags },
): Promise<ExitCode> {
  const { options } = request;
  const refusal = flagsRefusal(options);
  if (refusal !== undefined) {
    run.output.fail({ code: "protocol.bad_args", ...refusal });
    return 1;
  }
  if (cannotAskOwnerKey(run, options, "ceiling set")) {
    return 1;
  }
  const plan = await planOf(run, options);
  if (!plan.ok) {
    return plan.code;
  }
  const { wallet, changes } = plan.value;
  run.output.say(
    changes.dayCapUsdMicros === undefined ? "ceiling.everyWallet" : "ceiling.dayCapsEveryWallet",
  );
  const set = await withOwnerKey(run, options, {
    command: "ceiling set",
    call: async (client, ownerKey, signal) =>
      client.call("ceiling/set", { wallet: wallet.wallet, changes, ownerKey }, { signal }),
  });
  if (!set.ok) {
    return set.code;
  }
  run.output.say("ceiling.changed");
  printCeiling(run, { wallet, ceiling: set.value });
  return 0;
}
