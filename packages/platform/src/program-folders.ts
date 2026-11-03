import process from "node:process";

// Where package managers and installers put command line programs: Homebrew on Apple silicon and
// Intel Macs, and the system, local and snap folders on Linux. Windows installers add their own
// folder to the system PATH, which the background service inherits.
const foldersByOs: Readonly<Partial<Record<NodeJS.Platform, readonly string[]>>> = {
  darwin: ["/opt/homebrew/bin", "/usr/local/bin"],
  linux: ["/usr/local/bin", "/usr/bin", "/usr/sbin", "/snap/bin"],
  win32: [],
};

/**
 * The folders this OS's installers put command line programs in, which the background service's
 * `PATH` can lack: launchd starts a login service with only the system folders. A caller looks
 * there after the `PATH` it was given.
 */
export function programFolders(): readonly string[] {
  return foldersByOs[process.platform] ?? [];
}
