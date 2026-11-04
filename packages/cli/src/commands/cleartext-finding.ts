import { outboundRouteOf, routeChoiceOf, type Secret } from "@binference/core";
import type { BinferenceConfig } from "../config/schema/config.schema.js";
import type { CheckFinding } from "./check-finding.js";
import type { CliMessage } from "./config-issue-messages.js";

const check = "network.cleartext";

// An `http:` RPC address the route sends through the proxy: the proxy reads and could change
// every answer of it.
function cleartextRpcs(config: BinferenceConfig, proxy: Secret): number {
  const route = outboundRouteOf({ proxy, noProxy: config.network.noProxy });
  return Object.values(config.chains.rpc)
    .flatMap((rpc) => rpc.urls ?? [])
    .filter((url) => URL.canParse(url) && new URL(url).protocol === "http:")
    .filter((url) => routeChoiceOf(route, url) === "proxy").length;
}

// This machine, by name or loopback address: a proxy here sends no password across a network.
function isThisMachine(host: string): boolean {
  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host.startsWith("127.") ||
    host === "[::1]"
  );
}

// An `http:` proxy with a password on another machine: the password crosses the network in the
// clear, in each tunnel's request.
function isPasswordInClear(proxy: Secret): boolean {
  const url = new URL(proxy.reveal());
  return (
    url.protocol === "http:" && url.password !== "" && !isThisMachine(url.hostname.toLowerCase())
  );
}

/**
 * `network.cleartext` (decision 0347): a warning for what the proxy could read in the clear: the
 * `http:` RPC addresses in `chains.rpc` the route sends through it, whose answers it could change,
 * and the password of an `http:` proxy on another machine. It names neither the proxy nor an
 * address. Without a proxy URL it is skipped.
 */
export function cleartextFinding(
  read: { readonly config: BinferenceConfig; readonly proxy: Secret } | undefined,
): CheckFinding {
  if (read === undefined) {
    return { check, level: "skip" };
  }
  const { config, proxy } = read;
  const rpcs = cleartextRpcs(config, proxy);
  const password = isPasswordInClear(proxy);
  const messages: CliMessage[] = [
    ...(rpcs > 0 ? [{ key: "check.proxy.cleartextRpc", values: { count: rpcs } }] : []),
    ...(password ? [{ key: "check.proxy.cleartextPassword", values: {} }] : []),
  ];
  const [message, ...more] = messages;
  return message === undefined
    ? { check, level: "ok" }
    : { check, level: "warn", message, more, details: { rpcs, password } };
}
