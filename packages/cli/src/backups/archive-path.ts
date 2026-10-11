/** The archive path of the manifest, the last file of every backup. */
export const manifestPath = "manifest.json";

const topFiles = new Set(["engine.sqlite", "agent.sqlite", "config.json5", manifestPath]);
const workspace = "workspace/";
// Characters no file name of the state folder needs, and that some OS reads as more than a name.
const unsafe = /[\\:*?"<>|]/u;

function hasControl(text: string): boolean {
  return Array.from({ length: text.length }, (_, index) => text.charCodeAt(index)).some(
    (code) => code < 0x20,
  );
}

/**
 * Whether a path can stand in a backup's archive: one of the state folder's files a backup holds,
 * or a file under `workspace/`, with `/` between parts that are neither empty, `.` nor `..` and
 * hold no character an OS reads as a drive, a separator or a wildcard. So no file of a restore
 * lands outside the folder it is restored into, on any OS.
 */
export function isArchivePath(path: string): boolean {
  if (topFiles.has(path)) {
    return true;
  }
  if (!path.startsWith(workspace) || unsafe.test(path) || hasControl(path)) {
    return false;
  }
  return path
    .slice(workspace.length)
    .split("/")
    .every((part) => part !== "" && part !== "." && part !== "..");
}
