import { homedir } from "node:os";
import { isProxyUrl, outboundRouteOf, type Secret } from "@binference/core";
import { type ProxyProblem, probeProxy } from "../compose/proxy-probe.js";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import { createSecretReader } from "../config/secrets/secret-reader.js";
import type { CheckFinding, CheckLevel } from "./check-finding.js";
import { cleartextFinding } from "./cleartext-finding.js";
import type { InstallCheck } from "./install-findings.js";

const check = "network.proxy";

/** What keeps the proxy from carrying binference's requests. */
type FindingProblem = "unread" | "badUrl" | ProxyProblem;

// The proxy answered and the host did not: the proxy works, its own way out may not.
const levels: Readonly<Record<FindingProblem, CheckLevel>> = {
  unread: "fail",
  badUrl: "fail",
  auth: "fail",
  refused: "fail",
  unreachable: "fail",
  noAnswer: "warn",
};

function failed(problem: FindingProblem, status?: number): CheckFinding {
  const answered = status === undefined ? {} : { status };
  return {
    check,
    level: levels[problem],
    message: { key: `check.proxy.${problem}`, values: { status: String(status ?? "") } },
    details: { problem, ...answered },
  };
}

async function proxyOf(
  options: InstallCheck,
  config: BinferenceConfig,
): Promise<Secret | "unread"> {
  const { host, platform, signal } = options;
  const source = config.network.proxy;
  const secrets = createSecretReader({
    env: host.env,
    keychain: platform.keychain,
    homeDir: host.homeDir ?? homedir(),
    clock: host.clock,
  });
  try {
    return source === undefined ? "unread" : await secrets.read("network.proxy", source, signal);
  } catch {
    signal.throwIfAborted();
    return "unread";
  }
}

// One request through the proxy alone, whatever the no-proxy list holds.
async function probe(options: InstallCheck, proxy: Secret): Promise<CheckFinding> {
  const { host } = options;
  host.outbound.use(outboundRouteOf({ proxy, noProxy: [] }));
  const probed = await probeProxy(host.http, options.signal);
  return probed.problem === undefined
    ? { check, level: "ok" }
    : failed(probed.problem, probed.status);
}

/**
 * `network.proxy`: reads the proxy from its secret source and asks it, through the host's outbound
 * adapter, to reach Telegram's Bot API within 10 seconds. Any answer from Telegram is fine; a
 * proxy that cannot be read, is no `http:` or `https:` URL, asks for credentials, refuses the
 * host, cannot be connected to or never answers is a problem, and no answer from Telegram through
 * an open tunnel a warning. It names the problem and the proxy's status, never the proxy. It
 * leaves config's route in force, direct without a proxy, so the checks that follow, such as
 * `models.reachable`, reach out as the engine does. Without a config or a proxy it is skipped,
 * and so is `network.cleartext`, which follows it ({@link cleartextFinding}).
 */
export async function proxyFindings(
  options: InstallCheck,
  config: BinferenceConfig | undefined,
): Promise<readonly CheckFinding[]> {
  const skippedProxy: CheckFinding = { check, level: "skip" };
  const skipped = [skippedProxy, cleartextFinding(undefined)];
  if (config === undefined) {
    return skipped;
  }
  const { noProxy } = config.network;
  if (config.network.proxy === undefined) {
    options.host.outbound.use(outboundRouteOf({ noProxy }));
    return skipped;
  }
  const proxy = await proxyOf(options, config);
  try {
    if (proxy === "unread") {
      return [failed("unread"), cleartextFinding(undefined)];
    }
    if (!isProxyUrl(proxy.reveal())) {
      return [failed("badUrl"), cleartextFinding(undefined)];
    }
    return [await probe(options, proxy), cleartextFinding({ config, proxy })];
  } finally {
    options.host.outbound.use(outboundRouteOf({ proxy, noProxy }));
  }
}
