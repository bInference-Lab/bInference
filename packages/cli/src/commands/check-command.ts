import { createDeadline, type JsonValue } from "@binference/core";
import { platformOf } from "../compose/engine-locations.js";
import type { CheckFlags } from "../program/cli-flags.schema.js";
import type { CliOutput, ExitCode } from "../program/cli-output.js";
import type { CommandRun } from "../program/command-run.js";
import { accessFindings } from "./access-findings.js";
import type { CheckFinding } from "./check-finding.js";
import { configFinding, engineFinding, unlockFinding } from "./install-findings.js";
import { extraLaunchFinding } from "./launch-wallet-finding.js";
import { modelImagesFinding } from "./model-images-finding.js";
import { modelPriceFinding } from "./model-price-finding.js";
import { modelReachFinding } from "./model-reach-finding.js";
import { rpcFindings } from "./rpc-keyed-finding.js";

// Reading files and one engine call take moments; past this the check gives up.
const checkBudgetMs = 15_000;

function findingJson(finding: CheckFinding): JsonValue {
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

/**
 * `binference check [--fix]`: checks this install with or without a running engine, each finding
 * under a stable check id: `config.valid` (config.json5 loads and passes its schema),
 * `permissions.*` (the state folder and the files the specs keep owner-only), `unlock.mode` (a
 * warning in `file` mode, spec 5 section 3), `models.priced` (a warning naming each configured
 * model with no price, runtime spec section 8.3), `models.reachable` (one small live call to the
 * main model, decision 0221), `models.images` (where the owner's images go, decision 0228; its
 * notes print after the warnings), `engine.reachable`, `rpc.keyed` (a warning while live auto orders
 * watch prices over public RPCs only), `rpc.pushed` (a warning while they wait on blocks polled
 * over HTTP, with no `wss:` URL, decision 0209) and `wallets.extra_launch` (a warning naming each
 * extra launch wallet a rebuild adopted, decision 0218). `--fix` makes owner-only every path
 * others can open, the one fix the config spec names for it. It then says what the wallets'
 * ceiling promises against a machine whose keys are stolen (decision 0149), and that a launch
 * wallet is the one exception (decisions 0217 and 0218). Exits 1 while a problem remains, else
 * 0; warnings do not fail it. With `--json` it prints every finding.
 */
export async function runCheck(
  run: CommandRun,
  request: { readonly options: CheckFlags },
): Promise<ExitCode> {
  const { host, output } = run;
  const platform = platformOf(host);
  const deadline = createDeadline({
    clock: host.clock,
    signal: new AbortController().signal,
    timeoutMs: checkBudgetMs,
  });
  try {
    const { signal } = deadline;
    const config = await configFinding({ host, platform, signal });
    const access = await accessFindings({ platform, fix: request.options.fix, signal });
    const unlock = config.config === undefined ? [] : [unlockFinding(config.config, platform)];
    const prices = config.config === undefined ? [] : [modelPriceFinding(config.config)];
    const reach = await modelReachFinding({ host, platform, signal }, config.config);
    const images = modelImagesFinding(config.config);
    const engine = await engineFinding({ host, platform, signal });
    const rpc = await rpcFindings({ host, platform, signal }, config.config);
    const extra = await extraLaunchFinding({ host, platform, signal });
    const findings = [
      config.finding,
      ...access,
      ...unlock,
      ...prices,
      reach,
      images,
      engine,
      ...rpc,
      extra,
    ];
    printFindings(output, findings);
    return findings.some((finding) => finding.level === "fail") ? 1 : 0;
  } finally {
    deadline.clear();
  }
}
