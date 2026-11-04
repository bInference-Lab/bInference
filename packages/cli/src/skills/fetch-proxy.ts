import { err, isProxyUrl, ok, type ProxySetting, type Result } from "@binference/core";
import type { SkillSource } from "./skill-source.js";

/** The variables a skill fetch's `git` or `npm` runs with; `undefined` removes one it inherited. */
export type FetchEnv = Readonly<Record<string, string | undefined>>;

/** Why no skill fetch may run by the owner's proxy setting. */
export type FetchRouteRefusal = "proxy_held" | "ssh_through_proxy";

// The variables git (through curl, `git help config`, `http.proxy`) and npm (`npm help config`,
// `proxy`, `https-proxy`, `noproxy`) read for a proxy, in both cases where the tools read both.
const proxyVariables = [
  "HTTPS_PROXY",
  "https_proxy",
  "HTTP_PROXY",
  "http_proxy",
  "ALL_PROXY",
  "all_proxy",
];
const npmProxyVariables = ["npm_config_proxy", "npm_config_https_proxy"];
const noProxyVariables = ["NO_PROXY", "no_proxy", "npm_config_noproxy"];

// This machine never goes through the proxy, as the engine's own requests never do.
const thisMachine = ["localhost", "127.0.0.1", "::1"];

function each(names: readonly string[], value: string | undefined): FetchEnv {
  return Object.fromEntries(names.map((name) => [name, value]));
}

/**
 * The variables a skill fetch runs `git` or `npm` with, by the proxy setting in force (decision
 * 0347): through the proxy, for the child alone and only in its environment, never its arguments,
 * with the no-proxy list and this machine as its exceptions; without a proxy, none of the
 * variables the engine was started with, so a child never takes a route config did not name.
 * Refuses every fetch while a proxy is set that cannot be read or is no proxy URL
 * (`proxy_held`), and an `ssh://` git source while a proxy is set, since ssh cannot go through
 * it (`ssh_through_proxy`).
 */
export function fetchEnvOf(
  setting: ProxySetting,
  source: SkillSource,
): Result<FetchEnv, FetchRouteRefusal> {
  const { proxy } = setting;
  if (proxy === undefined) {
    return ok(each([...proxyVariables, ...npmProxyVariables, ...noProxyVariables], undefined));
  }
  if (proxy === "unread" || !isProxyUrl(proxy.reveal())) {
    return err("proxy_held");
  }
  if (source.kind === "git" && !/^(?:https|file):\/\//i.test(source.url)) {
    return err("ssh_through_proxy");
  }
  const url = proxy.reveal();
  const noProxy = [...thisMachine, ...setting.noProxy].join(",");
  return ok({
    ...each(proxyVariables, undefined),
    ...each(["HTTPS_PROXY", "https_proxy", "HTTP_PROXY", "http_proxy"], url),
    ...each(npmProxyVariables, url),
    ...each(noProxyVariables, noProxy),
  });
}
