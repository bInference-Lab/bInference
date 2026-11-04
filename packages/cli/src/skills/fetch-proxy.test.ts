import { createSecret } from "@binference/core";
import { describe, expect, it } from "vitest";
import { fetchEnvOf } from "./fetch-proxy.js";
import type { SkillSource } from "./skill-source.js";

const proxyUrl = "http://owner:pass@proxy.owner.test:3128";
const https: SkillSource = { kind: "git", url: "https://github.com/owner/skills.git", commit: "a" };
const npm: SkillSource = { kind: "npm", spec: "dca-skill@1.2.3", integrity: "sha512-a" };

describe("fetchEnvOf", () => {
  it("removes every proxy variable the engine was started with when no proxy is set", () => {
    const removed = Object.fromEntries(
      [
        "HTTPS_PROXY",
        "https_proxy",
        "HTTP_PROXY",
        "http_proxy",
        "ALL_PROXY",
        "all_proxy",
        "npm_config_proxy",
        "npm_config_https_proxy",
        "NO_PROXY",
        "no_proxy",
        "npm_config_noproxy",
      ].map((name) => [name, undefined]),
    );
    expect(fetchEnvOf({ noProxy: [] }, https)).toStrictEqual({ ok: true, value: removed });
  });

  it("hands git and npm the proxy and its exceptions through their environment", () => {
    const env = fetchEnvOf({ proxy: createSecret(proxyUrl), noProxy: ["corp.test"] }, npm);
    expect(env).toStrictEqual({
      ok: true,
      value: {
        HTTPS_PROXY: proxyUrl,
        https_proxy: proxyUrl,
        HTTP_PROXY: proxyUrl,
        http_proxy: proxyUrl,
        ALL_PROXY: undefined,
        all_proxy: undefined,
        npm_config_proxy: proxyUrl,
        npm_config_https_proxy: proxyUrl,
        NO_PROXY: "localhost,127.0.0.1,::1,corp.test",
        no_proxy: "localhost,127.0.0.1,::1,corp.test",
        npm_config_noproxy: "localhost,127.0.0.1,::1,corp.test",
      },
    });
  });

  it.each([
    ["cannot be read", "unread" as const],
    ["is no proxy URL", createSecret("proxy.owner.test:3128")],
  ])("holds every fetch while the proxy %s", (_case, proxy) => {
    expect(fetchEnvOf({ proxy, noProxy: [] }, npm)).toStrictEqual({
      ok: false,
      error: "proxy_held",
    });
  });

  it.each(["ssh://git@github.com/owner/skills.git", "git@github.com:owner/skills.git"])(
    "refuses the ssh source %s while a proxy is set",
    (url) => {
      const ssh: SkillSource = { kind: "git", url, commit: "a" };
      expect(fetchEnvOf({ proxy: createSecret(proxyUrl), noProxy: [] }, ssh)).toStrictEqual({
        ok: false,
        error: "ssh_through_proxy",
      });
      expect(fetchEnvOf({ noProxy: [] }, ssh).ok).toBe(true);
    },
  );
});
