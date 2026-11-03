import { readFile } from "node:fs/promises";
import { runCommand } from "../run-command.js";

const kib = 1024;

// Linux keeps each process's resident size in `/proc/<pid>/status`, in kB.
async function linuxResident(pid: number, signal: AbortSignal): Promise<number | undefined> {
  const status = await readFile(`/proc/${String(pid)}/status`, { encoding: "utf8", signal });
  const kb = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
  return kb === undefined ? undefined : Number(kb) * kib;
}

// macOS has no `/proc`; `ps` reports the resident size in KiB.
async function macResident(pid: number, signal: AbortSignal): Promise<number | undefined> {
  const text = (await runCommand("ps", ["-o", "rss=", "-p", String(pid)], signal)).trim();
  return /^\d+$/.test(text) ? Number(text) * kib : undefined;
}

/**
 * The resident memory of a running process in bytes: from `/proc` on Linux, from `ps` on macOS.
 * A process that has ended, or a reading that fails, is `undefined`.
 */
export async function posixResidentBytes(
  pid: number,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    return process.platform === "linux"
      ? await linuxResident(pid, signal)
      : await macResident(pid, signal);
  } catch {
    return undefined;
  }
}
