import type { Locale } from "@binference/protocol";
import type { SystemDefaults } from "../config/load-config.js";

type Env = Readonly<Record<string, string | undefined>>;

// An IANA zone such as Asia/Shanghai; TZ may also hold a path or a POSIX rule, which is ignored.
const zonePattern = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)*$/;

/**
 * The language the OS asks for: Chinese when the first of `LC_ALL`, `LC_MESSAGES` and `LANG` that
 * is set starts with `zh`, else English.
 */
export function systemLocale(env: Env): Locale {
  const tag = [env["LC_ALL"], env["LC_MESSAGES"], env["LANG"]].find(
    (value) => value !== undefined && value !== "",
  );
  return tag?.toLowerCase().startsWith("zh") === true ? "zh" : "en";
}

/**
 * The config defaults the machine decides: the OS language, the IANA zone in `TZ` or UTC, and the
 * unlock mode: `keychain` with a desktop session, else `file`, which needs none (spec 5, 3).
 */
export function systemDefaults(
  env: Env,
  session: { readonly hasDesktopSession: boolean },
): SystemDefaults {
  const timezone = env["TZ"] ?? "";
  return {
    locale: systemLocale(env),
    timezone: zonePattern.test(timezone) ? timezone : "UTC",
    unlockMode: session.hasDesktopSession ? "keychain" : "file",
  };
}
