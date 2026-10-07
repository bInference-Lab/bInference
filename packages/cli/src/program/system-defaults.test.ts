import { describe, expect, it } from "vitest";
import { systemDefaults, systemLocale } from "./system-defaults.js";

const headless = { hasDesktopSession: false };

describe("the machine's config defaults", () => {
  it.each([
    [{ LANG: "zh_CN.UTF-8" }, "zh"],
    [{ LC_ALL: "zh_TW", LANG: "en_US.UTF-8" }, "zh"],
    [{ LC_ALL: "", LC_MESSAGES: "en_GB", LANG: "zh_CN" }, "en"],
    [{ LANG: "de_DE.UTF-8" }, "en"],
    [{}, "en"],
  ])("reads %j as %s", (env, locale) => {
    expect(systemLocale(env)).toBe(locale);
  });

  it("takes an IANA zone from TZ and UTC for anything else", () => {
    expect(systemDefaults({ TZ: "Asia/Shanghai" }, headless)).toStrictEqual({
      locale: "en",
      timezone: "Asia/Shanghai",
      unlockMode: "file",
    });
    expect(systemDefaults({ TZ: ":/etc/localtime" }, headless).timezone).toBe("UTC");
    expect(systemDefaults({}, headless).timezone).toBe("UTC");
  });

  it("picks the keychain with a desktop session, and an owner-only file without one", () => {
    expect(systemDefaults({}, { hasDesktopSession: true }).unlockMode).toBe("keychain");
    expect(systemDefaults({}, headless).unlockMode).toBe("file");
  });
});
