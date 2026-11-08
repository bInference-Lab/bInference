import { posix } from "node:path";

// The program inside each macOS app bundle, by the app's name, in the order they are tried.
const macApps = [
  "Google Chrome",
  "Microsoft Edge",
  "Brave Browser",
  "Chromium",
  "Google Chrome Canary",
] as const;

const linuxPrograms = [
  "/usr/bin/google-chrome",
  "/usr/bin/google-chrome-stable",
  "/usr/bin/microsoft-edge",
  "/usr/bin/microsoft-edge-stable",
  "/usr/bin/brave-browser",
  "/usr/bin/brave",
  "/snap/bin/brave",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "/snap/bin/chromium",
  "/opt/google/chrome/chrome",
] as const;

/**
 * The places of a Chrome-family browser's program on macOS, in the order they are tried: Google
 * Chrome, Microsoft Edge, Brave, Chromium and Chrome Canary, in `/Applications`, then in the
 * owner's own `~/Applications`.
 */
export function macBrowserPrograms(home: string): readonly string[] {
  return ["/Applications", posix.join(home, "Applications")].flatMap((folder) =>
    macApps.map((app) => posix.join(folder, `${app}.app`, "Contents", "MacOS", app)),
  );
}

/**
 * The places of a Chrome-family browser's program on Linux, in the order they are tried: Google
 * Chrome, Microsoft Edge, Brave, then Chromium, as packages and snaps install them.
 */
export const linuxBrowserPrograms: readonly string[] = linuxPrograms;
