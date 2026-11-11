import { createDeadline, type JsonValue } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import type { CheckFlags } from "../program/cli-flags.schema.js";
import type { CliHost } from "../program/cli-host.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { accessFindings } from "./access-findings.js";
import type { CheckFinding } from "./check-finding.js";
import { fixedConfigFinding } from "./config-migration.js";
import { configFinding, engineFinding, unlockFinding } from "./install-findings.js";
import { modelImagesFinding } from "./model-images-finding.js";
import { modelPriceFinding } from "./model-price-finding.js";
import { modelReachFinding } from "./model-reach-finding.js";
import { pluginSandboxFinding } from "./plugin-sandbox-finding.js";
import { proxyFindings } from "./proxy-findings.js";
import { remoteFindings } from "./remote-findings.js";
import { roleWalletFindings } from "./role-wallet-findings.js";
import { rpcFindings } from "./rpc-keyed-finding.js";
import { shellWallFinding } from "./shell-wall-finding.js";

// Reading files and one engine call take moments; past this the check gives up.
const checkBudgetMs = 15_000;
// With `--fix`, an older config.json5 moves after a sealed backup, which takes longer.
const fixBudgetMs = 120_000;

/** A finding as `--json` prints it: its check id, its level and what scripts read beside them. */
export function findingJson(finding: CheckFinding): JsonValue {
  return { check: finding.check, level: finding.level, ...finding.details };
}

function printSection(output: CliOutput, heading: string, findings: readonly CheckFinding[]): void {
  if (findings.length === 0) {
    return;
  }
  output.say(heading);
  for (const finding of findings) {
    const lines = [finding.message, ...(finding.more ?? [])];
    lines.forEach((line) => line !== undefined && output.item(line.key, line.values));
  }
}

function printFindings(output: CliOutput, findings: readonly CheckFinding[]): void {
  output.json({ findings: findings.map(findingJson) });
  const at = (level: CheckFinding["level"]) =>
    findings.filter((finding) => finding.level === level && finding.fixed === undefined);
  output.say("check.summary", {
    checks: findings.length,
    problems: at("fail").length,
    warnings: at("warn").length,
  });
  output.say("check.ceilingPromise");
  const fixed = findings.flatMap((finding) => (finding.fixed === undefined ? [] : [finding.fixed]));
  if (fixed.length > 0) {
    output.say("check.fixes");
    fixed.forEach((line) => output.item(line.key, line.values));
  }
  printSection(output, "check.problems", at("fail"));
  printSection(output, "check.warnings", at("warn"));
  printSection(
    output,
    "check.notes",
    at("ok").filter((finding) => finding.message !== undefined),
  );
  const unchecked = at("skip").length;
  if (unchecked > 0) {
    output.say("check.unchecked", { count: unchecked });
  }
}

/** What one run of the checks reads: the host, and whether `--fix` repairs what it may. */
export interface CheckRun {
  readonly host: CliHost;
  readonly fix: boolean;
  readonly signal: AbortSignal;
}

/**
 * Every finding of `binference check` on the host's install, in the order it prints them. With
 * `fix` it moves an older config.json5 to this version and makes owner-only every path others can
 * open, and each finding says so.
 */
export async function checkFindings(run: CheckRun): Promise<readonly CheckFinding[]> {
  const { host, fix, signal } = run;
  const platform = platformOf(host);
  const install = { host, platform, signal };
  const config = await (fix ? fixedConfigFinding(install) : configFinding(install));
  const access = await accessFindings({ platform, fix, signal });
  const unlock = config.config === undefined ? [] : [unlockFinding(config.config, platform)];
  const prices = config.config === undefined ? [] : [modelPriceFinding(config.config)];
  // Before every check that reaches out, which then goes by the owner's proxy as the engine does.
  const proxy = await proxyFindings({ host, platform, signal }, config.config);
  const reach = await modelReachFinding({ host, platform, signal }, config.config);
  const images = modelImagesFinding(config.config);
  const engine = await engineFinding({ host, platform, signal });
  const rpc = await rpcFindings({ host, platform, signal }, config.config);
  const roles = await roleWalletFindings({ host, platform, signal });
  const remote = await remoteFindings({ host, platform, signal }, config.config);
  const sandbox = await pluginSandboxFinding({ host, platform, signal });
  const wall = await shellWallFinding({ host, platform });
  return [
    config.finding,
    ...access,
    ...unlock,
    ...prices,
    ...proxy,
    reach,
    images,
    engine,
    ...rpc,
    ...roles,
    ...remote,
    sandbox,
    wall,
  ];
}

/**
 * `binference check [--fix]`: checks this install with or without a running engine, each finding
 * under a stable check id: `config.valid` (config.json5 loads and passes its schema),
 * `permissions.*` (the state folder and the files the specs keep owner-only), `unlock.mode` (a
 * warning in `file` mode, spec 5 section 3), `models.priced` (a warning naming each configured
 * model with no price, runtime spec section 8.3), `network.proxy` (the owner's proxy reaches
 * Telegram, and every check after it goes by the proxy), `network.cleartext` (what the proxy could
 * read in the clear), `models.reachable` (one small live call to the
 * main model, decision 0221), `models.images` (where the owner's images go, decision 0228; its
 * notes print after the warnings), `engine.reachable`, `rpc.keyed` (a warning while live auto orders
 * watch prices over public RPCs only), `rpc.pushed` (a warning while they wait on blocks polled
 * over HTTP, with no `wss:` URL, decision 0209), `wallets.extra_launch` and `wallets.extra_bridge`
 * (a warning naming each extra launch or bridge wallet a rebuild adopted, decisions 0218 and 0307)
 * and `wallets.launch_calls` and `wallets.bridge_calls` (a warning naming each launch or bridge
 * wallet whose ceiling lacks calls its venues need, with the owner key's fix, decisions 0271 and
 * 0307), `remote.funnel`, `remote.loopback` and `remote.serve` (decision 0341), and `shell.wall`
 * (what keeps the agent's commands from binference's own folder, decision 0412). `--fix` moves
 * an older config.json5 to this version after a sealed backup, and makes owner-only every path
 * others can open, the fixes the config spec names. It then says what the wallets' ceiling promises against a machine whose keys are stolen
 * (decision 0149), and that a launch wallet and a bridge wallet are the exceptions (decisions
 * 0217, 0218 and 0307). Exits 1 while a problem remains, else
 * 0; warnings do not fail it. With `--json` it prints every finding.
 */
export async function runCheck(
  run: CommandRun,
  request: { readonly options: CheckFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: request.options.fix ? fixBudgetMs : checkBudgetMs,
  });
  try {
    const { signal } = deadline;
    const findings = await checkFindings({ host, fix: request.options.fix, signal });
    printFindings(output, findings);
    return findings.some((finding) => finding.level === "fail") ? 1 : 0;
  } finally {
    deadline.clear();
  }
}
