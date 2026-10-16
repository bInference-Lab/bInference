import { BinferenceError, createIdSource } from "@binference/core";
import type { Formatter } from "@binference/i18n";
import { acquireFileLock, ensurePrivateFolder, readTextFile } from "@binference/platform";
import type { Locale } from "@binference/protocol";
import {
  createSqliteAccessStore,
  createSqliteAgentStore,
  createSqliteInstallStore,
  type DatabaseHandle,
  engineWorker,
  isDatabaseLeftOpen,
  openDatabase,
} from "@binference/store";
import { type AttachAfterRestore, runAttach } from "../attach/run-attach.js";
import { runRebuild } from "../attach/run-rebuild.js";
import { layeredAnswers } from "../init/answer-layers.js";
import { earlierAnswersOf } from "../init/earlier-answers.js";
import type { InitStart } from "../init/first-answers.js";
import type { InitContext, InitRefusal } from "../init/init-context.js";
import { initFaultOf } from "../init/init-faults.js";
import type { InitStores } from "../init/install-step.js";
import { takeLanguage } from "../init/language-step.js";
import { runInit } from "../init/run-init.js";
import type { InitFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import { type CliOutput, createCliOutput, type ExitCode } from "../program/cli-output.js";
import { ownerFormatter } from "../program/owner-formatter.js";
import { systemDefaults } from "../program/system-defaults.js";
import { attachSummary } from "./attach-summary.js";
import { configIssueMessages } from "./config-issue-messages.js";
import { initContextOf } from "./init-context-of.js";
import { finishSetUp, type Report, setupSummary } from "./init-summary.js";
import { rebuildSummary } from "./rebuild-summary.js";
import { restoreAndAttach } from "./restore-attach.js";

/**
 * Prints why an init step refused: its `init` message and the config issues under it on standard
 * error, or `{ error: { code, details? } }` with `--json`. Answers the exit code 1.
 */
export function refuse(context: InitContext, report: Report, refusal: InitRefusal): ExitCode {
  const { output } = report;
  if (report.isJson) {
    const issues = refusal.issues?.map((issue) => ({
      path: issue.path,
      problem: issue.problem.kind,
    }));
    output.json({
      error: { code: refusal.code, ...(issues === undefined ? {} : { details: issues }) },
    });
    return 1;
  }
  context.host.err(`${context.words(refusal.key, refusal.values)}\n`);
  for (const issue of refusal.issues ?? []) {
    configIssueMessages(issue).forEach(({ key, values }) => output.explain(key, values));
  }
  return 1;
}

async function openStores(
  context: InitContext,
): Promise<{ database: DatabaseHandle; stores: InitStores } | undefined> {
  const { host, platform, signal } = context;
  const database = await openDatabase({
    file: platform.stateFolder.engineDatabase,
    worker: engineWorker,
    execArgv: host.workerExecArgv ?? [],
    signal,
  });
  await database.migrate({ signal });
  if (!(await database.checkIntegrity({ signal })).ok) {
    await database.close();
    return undefined;
  }
  return {
    database,
    stores: {
      install: createSqliteInstallStore(database),
      agents: createSqliteAgentStore(database),
      access: createSqliteAccessStore(database),
    },
  };
}

// An install is set up once its config file or its custody exists; only a start over goes on.
async function isSetUp(context: InitContext, stores: InitStores): Promise<boolean> {
  const config = await readTextFile(context.platform.stateFolder.configFile, context.signal);
  const facts = await stores.install.read({ signal: context.signal });
  return config.ok || facts.custody !== undefined;
}

// Makes this machine the signer of the install's wallets in place of the one that was; on a
// folder with no install and no config, rebuilds what Privy holds (decision 0142).
async function attachOnStores(
  context: InitContext,
  report: Report,
  on: { readonly stores: InitStores; readonly restore: AttachAfterRestore | undefined },
): Promise<ExitCode> {
  const { stores, restore } = on;
  const { host, signal, platform } = context;
  const proposal = { id: createIdSource(host).next("ins"), atMs: host.clock.now() };
  const installId = await stores.install.installId(proposal, { signal });
  const { custody } = await stores.install.read({ signal });
  if (custody !== undefined) {
    const found = { custody, installId, ...(restore === undefined ? {} : { restore }) };
    const attached = await runAttach(context, stores.install, found);
    return attached.ok
      ? attachSummary(context, report.output, attached.value)
      : refuse(context, report, attached.refusal);
  }
  if ((await readTextFile(platform.stateFolder.configFile, signal)).ok) {
    const values = { folder: platform.stateFolder.root };
    return refuse(context, report, {
      code: "init.attach_config_only",
      key: "refused.attachConfigOnly",
      values,
    });
  }
  const rebuilt = await runRebuild(context, stores, installId);
  return rebuilt.ok
    ? rebuildSummary(context, report, rebuilt.value)
    : refuse(context, report, rebuilt.refusal);
}

async function initOnStores(
  context: InitContext,
  report: Report,
  on: { readonly start?: InitStart; readonly restore?: AttachAfterRestore } = {},
): Promise<ExitCode> {
  const { start = {}, restore } = on;
  const { engineDatabase } = context.platform.stateFolder;
  // A database copied while its engine ran, or one an engine did not close, is never attached:
  // opening it would write over what the copy left half done (decision 0142).
  if (context.flags.isAttach && (await isDatabaseLeftOpen(engineDatabase, context.signal))) {
    return refuse(context, report, {
      code: "init.attach_left_open",
      key: "refused.attachLeftOpen",
      values: { file: engineDatabase },
    });
  }
  const opened = await openStores(context);
  const folder = context.platform.stateFolder;
  if (opened === undefined) {
    return refuse(context, report, {
      code: "store.damaged",
      key: "refused.storeDamaged",
      values: { file: folder.engineDatabase },
    });
  }
  try {
    const { stores } = opened;
    if (context.flags.isAttach) {
      return await attachOnStores(context, report, { stores, restore });
    }
    if (!context.flags.isStartOver && (await isSetUp(context, stores))) {
      return refuse(context, report, {
        code: "init.already_set_up",
        key: "refused.alreadySetUp",
        values: { folder: folder.root },
      });
    }
    const { host } = context;
    const ids = createIdSource({ clock: host.clock, random: host.random });
    const installId = await stores.install.installId(
      { id: ids.next("ins"), atMs: host.clock.now() },
      { signal: context.signal },
    );
    const outcome = await runInit(context, stores, { ...start, installId });
    return outcome.ok
      ? setupSummary(context, report, outcome.value)
      : refuse(context, report, outcome.refusal);
  } finally {
    await opened.database.close();
  }
}

// Flags that cannot go together, or one that needs another.
function flagConflictOf(flags: InitFlags): InitRefusal | undefined {
  if (flags.isAttach && flags.isStartOver) {
    return { code: "init.attach_start_over", key: "refused.attachStartOver" };
  }
  if (!flags.isAttach && flags.restore !== undefined) {
    return { code: "init.restore_needs_attach", key: "refused.restoreNeedsAttach" };
  }
  return flags.isAttach && flags.ownerKeyPublic !== undefined
    ? { code: "init.attach_owner_key_public", key: "refused.attachOwnerKeyPublic" }
    : undefined;
}

// The language step and an earlier set-up's answers come first, for a new set-up only: attach
// and restore take the install's own config.
async function startOf(context: InitContext): Promise<InitStart> {
  const { flags } = context;
  if (flags.isAttach || flags.restore !== undefined) {
    return {};
  }
  const earlier = await earlierAnswersOf(context);
  const locale = await takeLanguage(context, earlier?.locale);
  return {
    ...(earlier === undefined ? {} : { earlier }),
    ...(locale === undefined ? {} : { locale }),
  };
}

function inLanguage(
  context: InitContext,
  report: Report,
  locale: Locale | undefined,
): { readonly context: InitContext; readonly report: Report } {
  if (locale === undefined) {
    return { context, report };
  }
  const { host, flags, platform } = context;
  const timezone = systemDefaults(host.env, platform).timezone;
  const formatter = ownerFormatter({ locale, timezone });
  const output = createCliOutput({ host, formatter, isJson: report.isJson });
  return {
    context: initContextOf(host, output, { flags, formatter, origins: context.origins }),
    report: { output, formatter, isJson: report.isJson },
  };
}

async function underLock(
  context: InitContext,
  report: Report,
  start: InitStart,
): Promise<ExitCode> {
  const { flags } = context;
  const folder = context.platform.stateFolder;
  await ensurePrivateFolder(folder.root, {
    permissions: context.platform.permissions,
    signal: context.signal,
  });
  const lock = acquireFileLock(folder.engineLock);
  if (!lock.ok) {
    return refuse(context, report, {
      code: "engine.already_running",
      key: "refused.engineRunning",
      values: { folder: folder.root },
    });
  }
  try {
    return flags.restore === undefined
      ? await initOnStores(context, report, { start })
      : await restoreAndAttach(context, flags.restore, {
          attach: async (restore) => initOnStores(context, report, { restore }),
          refuse: (refusal) => refuse(context, report, refusal),
        });
  } finally {
    lock.value.release();
  }
}

async function refusingFaults(
  context: InitContext,
  report: Report,
  run: () => Promise<ExitCode>,
): Promise<ExitCode> {
  try {
    return await run();
  } catch (error) {
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    return refuse(context, report, initFaultOf(error));
  }
}

/**
 * `binference init`: sets up a new install (keys spec, section 2) under the engine lock, so no
 * engine runs on the folder meanwhile, its questions in the language the person picks first. It
 * refuses a folder set up before unless the owner asks to start over, which offers the earlier
 * answers first, and never replaces a stored agent key. A new set-up ends with the service step
 * once the lock is let go. With `--attach` it makes this machine the signer of the folder's
 * install instead (keys spec, section 6; decision 0140), after restoring a backup into the folder
 * with `--restore` (keys spec, section 7.4). A person at a terminal answers its questions; with
 * `--yes`, `--json` or no terminal, every answer comes from a flag, its `BINFERENCE_INIT_*`
 * variable or the answers file (decision 0224). Exits 0 once the install is set up or attached, 1 when it refused or
 * failed.
 */
export async function runInitCommand(
  host: CliHost,
  output: CliOutput,
  options: { readonly flags: InitFlags; readonly formatter: Formatter },
): Promise<ExitCode> {
  const { formatter } = options;
  const bare = initContextOf(host, output, options);
  const firstReport: Report = { output, formatter, isJson: options.flags.json };
  const run = { signal: bare.signal, words: bare.words };
  const layered = await layeredAnswers(options.flags, host.env, run);
  if (!layered.ok) {
    return refuse(bare, firstReport, layered.refusal);
  }
  const { flags, origins } = layered.value;
  const first = initContextOf(host, output, { flags, formatter, origins });
  const conflict = flagConflictOf(flags);
  if (conflict !== undefined) {
    return refuse(first, firstReport, conflict);
  }
  first.prompter.intro(first.words("title"));
  return refusingFaults(first, firstReport, async () => {
    const start = await startOf(first);
    const { context, report } = inLanguage(first, firstReport, start.locale);
    const code = await refusingFaults(context, report, async () =>
      underLock(context, report, start),
    );
    const isNewSetUp = !flags.isAttach && flags.restore === undefined;
    return code === 0 && isNewSetUp ? finishSetUp(context, report) : code;
  });
}
