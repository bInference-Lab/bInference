import { setTimeout as wait } from "node:timers/promises";
import { BinferenceError, type Id } from "@binference/core";
import {
  type EngineStores,
  type IntentState,
  intentStates,
  isTerminalState,
} from "@binference/engine";
import { proposeAndTap } from "../fork/rig-actions.js";
import type { CliHost } from "../program/cli-host.js";
import type { CrashEnv, CrashEvent } from "./crash-engine.schema.js";
import { composeCrashTrading, type CrashTrading } from "./crash-trading.js";
import { type CrashOpened, openCrashEngine } from "./open-crash-engine.js";
import { setUpCrashInstall } from "./set-up-crash-install.js";

// One run of the engine, from its start to every intent's end; a run that has not settled by then
// is a failure the test reports.
const runBudgetMs = 150_000;
// The shutdown's budget for the executor, then for the other parts.
const closeMs = 30_000;
// How often it reads whether an intent has ended.
const pollMs = 200;

async function endOf(
  stores: EngineStores,
  intent: Id<"int">,
  signal: AbortSignal,
): Promise<IntentState> {
  const record = await stores.intents.get(intent, { signal });
  if (record === undefined) {
    throw new BinferenceError({ code: "crash.intent_gone", message: "The intent is not stored." });
  }
  if (isTerminalState(record.state)) {
    return record.state;
  }
  await wait(pollMs, undefined, { signal });
  return endOf(stores, intent, signal);
}

// Waits until every live intent of the state folder has ended, and reports each with the hashes
// of the transactions the engine stored for it.
async function settleEvery(
  stores: EngineStores,
  report: (event: CrashEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const query = { states: [...intentStates], isPaper: false, limit: 10 };
  const intents = await stores.intents.list(query, { signal });
  await Promise.all(
    intents.map(async ({ id }) => {
      const state = await endOf(stores, id, signal);
      const stored = await stores.transactions.ofIntent(id, { signal });
      report({ event: "settled", intent: id, state, hashes: stored.map(({ hash }) => hash) });
    }),
  );
}

async function trade(
  opened: CrashOpened,
  trading: CrashTrading,
  run: { readonly report: (event: CrashEvent) => void; readonly signal: AbortSignal },
): Promise<void> {
  const { report, signal } = run;
  const isNew = (await opened.stores.install.read({ signal })).custody === undefined;
  if (isNew) {
    await setUpCrashInstall(opened, trading.account, signal);
  }
  // The startup order of `binference start`: what a stop left unsettled is recovered by hash and
  // nonce before the executor takes any confirmed intent.
  const intents = await trading.executor.recover({ signal });
  await trading.executor.takeConfirmed({ signal });
  report({ event: "recovered", intents });
  if (isNew) {
    report({ event: "proposed", intent: await proposeAndTap(trading, signal) });
  }
  await settleEvery(opened.stores, report, signal);
}

/**
 * One start of the crash engine on the state folder `BINFERENCE_HOME` names. A fresh folder is
 * set up, recovers nothing and proposes one swap, which the owner confirms at once; a folder an
 * earlier engine left recovers what it left. Either way it waits until every intent has ended,
 * then stops its parts in the shutdown order.
 */
export async function runCrashEngine(
  host: CliHost,
  env: CrashEnv,
  report: (event: CrashEvent) => void,
): Promise<void> {
  const signal = AbortSignal.timeout(runBudgetMs);
  const opened = await openCrashEngine(host, signal);
  const executor: { current?: CrashTrading["executor"] } = {};
  try {
    const walletName = env.CRASH_WALLET;
    const isHolding = env.CRASH_HOLD === "signed";
    const trading = composeCrashTrading(opened, { walletName, isHolding, report });
    executor.current = trading.executor;
    await trade(opened, trading, { report, signal });
  } finally {
    await executor.current?.close({ signal: AbortSignal.timeout(closeMs) });
    await opened.closers.closeAll(AbortSignal.timeout(closeMs));
  }
}
