import { join } from "node:path";
import { createDeadline, type JsonValue, jsonValueSchema } from "@binference/core";
import { fileSize, readLogLines } from "@binference/platform";
import { operations } from "@binference/protocol";
import { z } from "zod";
import { checkFindings, findingJson } from "../commands/check-command.js";
import { connectEngine } from "../commands/connect-engine.js";
import { configFinding } from "../commands/install-findings.js";
import { engineLogFile, platformOf } from "../compose/engine-locations.js";
import { serviceLogFile } from "../compose/engine-service.js";
import { isObject, shownConfig } from "../config/shown-config.js";
import type { CliHost } from "../program/cli-host.js";
import { redactReportJson } from "./report-json.js";
import { reportLogLine } from "./report-log-line.js";
import type { ReportPlaces } from "./report-text.js";

// The checks and the engine's answer each get at most this long.
const checkBudgetMs = 15_000;
const engineBudgetMs = 5_000;
// The newest part of the engine log the bundle reads, and the most lines it keeps of it.
const logTailBytes = 2 * 1024 * 1024;
const maxLogLines = 2_000;

/** What `binference report` collects, before it is written. */
interface CollectedReport {
  readonly [key: string]: JsonValue;
}

async function withBudget<T>(
  host: CliHost,
  budgetMs: number,
  use: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const signal = new AbortController().signal;
  const deadline = createDeadline({ clock: host.clock, signal, timeoutMs: budgetMs });
  try {
    return await use(deadline.signal);
  } finally {
    deadline.clear();
  }
}

// The engine's `engine/status`, or why it did not answer.
async function engineStatus(host: CliHost): Promise<JsonValue> {
  return withBudget(host, engineBudgetMs, async (signal) => {
    const connection = await connectEngine(host, signal);
    if (!connection.ok) {
      return { answered: false, reason: connection.reason };
    }
    try {
      const status = await connection.client.call("engine/status", {}, { signal });
      const json = jsonValueSchema.parse(z.encode(operations["engine/status"].result, status));
      return { answered: true, status: json };
    } catch {
      return { answered: false, reason: "failed" };
    } finally {
      connection.client.close();
    }
  });
}

// The newest lines of the engine log that have its JSON shape, each by the field rules, and how
// many lines were left out; then only the size of the service's own output, which is free text.
async function logs(host: CliHost, signal: AbortSignal): Promise<JsonValue> {
  const platform = platformOf(host);
  const tail = await readLogLines(engineLogFile(platform), { maxBytes: logTailBytes, signal });
  const read = tail.ok ? tail.value.lines.slice(-maxLogLines) : [];
  const kept = read.flatMap((text) => {
    const line = reportLogLine(text);
    return line === undefined ? [] : [line];
  });
  const service = await fileSize(serviceLogFile(platform), signal);
  return {
    engineLog: tail.ok ? "read" : "none",
    lines: kept,
    omittedLines: read.length - kept.length,
    ...(service.ok ? { serviceLogBytes: service.value } : {}),
  };
}

/**
 * Collects the support bundle of the host's install: the versions of binference, Node, the OS and
 * the CPU type; the config with each secret source shown as its kind; every finding of
 * `binference check`; the engine's status if it answers; and the newest engine log lines, kept by
 * the field rules of {@link reportLogLine}. Every value but the log lines then passes through
 * {@link redactReportJson}. Reads only: it opens no key, no database and no secret.
 */
export async function collectReport(host: CliHost, places: ReportPlaces): Promise<CollectedReport> {
  const platform = platformOf(host);
  const signal = new AbortController().signal;
  const loaded = await configFinding({ host, platform, signal });
  const config = loaded.config === undefined ? {} : { config: shownConfig(loaded.config) };
  const findings = await withBudget(host, checkBudgetMs, async (budget) =>
    checkFindings({ host, fix: false, signal: budget }),
  );
  const status = await engineStatus(host);
  const redacted = redactReportJson(
    {
      versions: { binference: host.version, ...host.system },
      ...config,
      check: findings.map(findingJson),
      engine: status,
    },
    places,
  );
  return {
    format: "binference-report",
    version: 1,
    createdAt: new Date(host.clock.now()).toISOString(),
    ...(isObject(redacted) ? redacted : {}),
    logs: await logs(host, signal),
  };
}

/** Where `binference report` writes a bundle: `reports/` in the state folder, named by its time. */
export function reportFileOf(host: CliHost, atMs: number): string {
  const stamp = new Date(atMs).toISOString().replaceAll(/[-:]/gu, "").slice(0, 15);
  return join(platformOf(host).stateFolder.root, "reports", `report-${stamp}.json`);
}
