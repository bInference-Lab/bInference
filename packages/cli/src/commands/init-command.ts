import { homedir } from "node:os";
import { BinferenceError, createIdSource, type JsonValue } from "@binference/core";
import type { Formatter, MessageValues } from "@binference/i18n";
import { acquireFileLock, ensurePrivateFolder, readTextFile } from "@binference/platform";
import {
  createSqliteAccessStore,
  createSqliteAgentStore,
  createSqliteInstallStore,
  type DatabaseHandle,
  engineWorker,
  openDatabase,
} from "@binference/store";
import { platformOf } from "../compose/engine-locations.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { InitContext, InitRefusal } from "../init/init-context.js";
import { initFaultOf } from "../init/init-faults.js";
import type { InitStores } from "../init/install-step.js";
import { type InitOutcome, runInit } from "../init/run-init.js";
import type { InitFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import { createOutputPrompter } from "../term/output-prompter.js";
import { configIssueMessages } from "./config-issue-messages.js";

/** What the init command reports with: the command's output and the owner's formatter. */
interface Report {
  readonly output: CliOutput;
  readonly formatter: Formatter;
  readonly isJson: boolean;
}

function refuse(context: InitContext, report: Report, refusal: InitRefusal): ExitCode {
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

function summary(context: InitContext, report: Report, outcome: InitOutcome): ExitCode {
  const { words } = context;
  const lines = [
    words("done.wallet", { address: outcome.walletAddress }),
    words("done.paper"),
    words(outcome.isAgentKeyNew ? "done.unlockMade" : "done.unlockKept", {
      mode: outcome.unlockMode,
    }),
    words("done.pairing", {
      bot: outcome.botUsername,
      link: outcome.pairingLink.reveal(),
      expires: report.formatter.dateTime(outcome.pairingExpiresAtMs),
    }),
    words("done.config", { file: outcome.configFile }),
  ];
  context.prompter.note(lines.join("\n\n"), words("done.title"));
  context.prompter.outro(words("done.next"));
  const answer: JsonValue = {
    state: "set_up",
    wallet: { address: outcome.walletAddress, privyWalletId: outcome.privyWalletId },
    unlockMode: outcome.unlockMode,
    agentKey: outcome.isAgentKeyNew ? "made" : "kept",
    // Nobody saw the code on a terminal: the script that ran init takes it from here, once.
    ...(context.isInteractive ? {} : { ownerKeyCode: outcome.ownerKeyCode.reveal() }),
    pairing: { link: outcome.pairingLink.reveal(), expiresAtMs: outcome.pairingExpiresAtMs },
    configFile: outcome.configFile,
  };
  report.output.json(answer);
  return 0;
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

async function initOnStores(context: InitContext, report: Report): Promise<ExitCode> {
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
    const outcome = await runInit(context, stores, installId);
    return outcome.ok
      ? summary(context, report, outcome.value)
      : refuse(context, report, outcome.refusal);
  } finally {
    await opened.database.close();
  }
}

function contextOf(
  host: CliHost,
  output: CliOutput,
  options: { readonly flags: InitFlags; readonly formatter: Formatter },
): InitContext {
  const { flags, formatter } = options;
  const platform = platformOf(host);
  const isInteractive = host.prompter !== undefined && !flags.yes && !flags.json;
  return {
    host,
    platform,
    flags,
    prompter:
      isInteractive && host.prompter !== undefined ? host.prompter : createOutputPrompter(output),
    isInteractive,
    words: (key: string, values?: MessageValues) => formatter.message(`init.${key}`, values),
    secrets: createSecretReader({
      env: host.env,
      keychain: platform.keychain,
      homeDir: host.homeDir ?? homedir(),
      clock: host.clock,
    }),
    signal: new AbortController().signal,
  };
}

/**
 * `binference init`: sets up a new install (keys spec, section 2) under the engine lock, so no
 * engine runs on the folder meanwhile. It refuses a folder set up before unless the owner asks
 * to start over, and never replaces a stored agent key. A person at a terminal answers its
 * questions; with `--yes`, `--json` or no terminal, every answer comes from a flag. Exits 0 once
 * the install is set up, 1 when it refused or failed.
 */
export async function runInitCommand(
  host: CliHost,
  output: CliOutput,
  options: { readonly flags: InitFlags; readonly formatter: Formatter },
): Promise<ExitCode> {
  const { flags, formatter } = options;
  const context = contextOf(host, output, options);
  const report: Report = { output, formatter, isJson: flags.json };
  const folder = context.platform.stateFolder;
  context.prompter.intro(context.words("title"));
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
    return await initOnStores(context, report);
  } catch (error) {
    if (!(error instanceof BinferenceError)) {
      throw error;
    }
    return refuse(context, report, initFaultOf(error));
  } finally {
    lock.value.release();
  }
}
