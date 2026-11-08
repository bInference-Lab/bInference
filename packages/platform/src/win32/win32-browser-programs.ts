import { win32 } from "node:path";

// Each program below a programs folder, in the order they are tried.
const programs = [
  ["Google", "Chrome", "Application", "chrome.exe"],
  ["Microsoft", "Edge", "Application", "msedge.exe"],
  ["BraveSoftware", "Brave-Browser", "Application", "brave.exe"],
  ["Chromium", "Application", "chrome.exe"],
] as const;

/**
 * The places of a Chrome-family browser's program on Windows, in the order they are tried: Google
 * Chrome, Microsoft Edge, Brave, then Chromium, installed for the owner alone in
 * `AppData\Local`, then for every user in `Program Files` and `Program Files (x86)`.
 */
export function windowsBrowserPrograms(home: string): readonly string[] {
  const folders = [
    win32.join(home, "AppData", "Local"),
    "C:\\Program Files",
    "C:\\Program Files (x86)",
  ];
  return folders.flatMap((folder) => programs.map((parts) => win32.join(folder, ...parts)));
}
