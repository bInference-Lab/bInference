import { homedir } from "node:os";
import type { Secret } from "@binference/core";
import { checkModel, type ModelCheckProblem } from "@binference/runtime";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { ProviderConfig } from "../config/schema/telegram-models.schema.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CheckFinding } from "./check-finding.js";
import type { InstallCheck } from "./install-findings.js";

const check = "models.reachable";
// The check's own share of `binference check`'s budget.
const checkTimeoutMs = 10_000;

/** What keeps the main model from answering: a check's problem, or a config that cannot call it. */
type ReachProblem = ModelCheckProblem | "noProvider" | "keyUnread";

// Problems that waiting or the network may end are warnings; the others need the owner's fix.
const passing: ReadonlySet<ReachProblem> = new Set(["rate_limited", "unreachable"]);

/** The main model's provider and its id there, split from `<provider>/<model>`. */
interface MainModel {
  readonly provider: string;
  readonly model: string;
  readonly config?: ProviderConfig;
}

function mainOf(config: BinferenceConfig): MainModel | undefined {
  const main = config.models.main;
  const slash = main?.indexOf("/") ?? -1;
  if (main === undefined || slash <= 0) {
    return undefined;
  }
  const provider = main.slice(0, slash);
  const providerConfig = config.models.providers[provider];
  return {
    provider,
    model: main.slice(slash + 1),
    ...(providerConfig === undefined ? {} : { config: providerConfig }),
  };
}

function failed(main: MainModel, problem: ReachProblem): CheckFinding {
  const values = { provider: main.provider, model: main.model };
  return {
    check,
    level: passing.has(problem) ? "warn" : "fail",
    message: { key: `check.model.${problem}`, values },
    details: { model: `${main.provider}/${main.model}`, problem },
  };
}

async function keyOf(
  options: InstallCheck,
  main: MainModel & { readonly config: ProviderConfig },
): Promise<Secret | "unread" | undefined> {
  const source = main.config.apiKey;
  if (source === undefined) {
    return undefined;
  }
  const { host, platform, signal } = options;
  const secrets = createSecretReader({
    env: host.env,
    keychain: platform.keychain,
    homeDir: host.homeDir ?? homedir(),
    clock: host.clock,
  });
  try {
    return await secrets.read(`models.providers.${main.provider}.apiKey`, source, signal);
  } catch {
    signal.throwIfAborted();
    return "unread";
  }
}

/**
 * `models.reachable` (decision 0221): one small live call to `models.main` through the official
 * client of its provider's kind, within 10 seconds, with the key read from its secret source.
 * A refused key, no credit, an unknown model or an address that is no model API is a problem; a
 * rate limit or no answer is a warning. It names the provider and the model, never the key.
 * Without a config or a main model it is skipped.
 */
export async function modelReachFinding(
  options: InstallCheck,
  config: BinferenceConfig | undefined,
): Promise<CheckFinding> {
  const main = config === undefined ? undefined : mainOf(config);
  if (main === undefined) {
    return { check, level: "skip" };
  }
  const { config: provider } = main;
  if (provider === undefined) {
    return failed(main, "noProvider");
  }
  const key = await keyOf(options, { ...main, config: provider });
  if (key === "unread") {
    return failed(main, "keyUnread");
  }
  const { host } = options;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(checkTimeoutMs)]);
  const target = {
    kind: provider.kind,
    ...(provider.baseUrl === undefined ? {} : { baseUrl: provider.baseUrl }),
    ...(key === undefined ? {} : { apiKey: key }),
    model: main.model,
  };
  const parts = { http: host.http, clock: host.clock, timeoutMs: checkTimeoutMs, signal };
  const checked = await checkModel(target, parts);
  return checked.ok
    ? { check, level: "ok", details: { model: `${main.provider}/${main.model}` } }
    : failed(main, checked.error);
}
