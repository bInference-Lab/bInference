import { runCommand } from "../run-command.js";

/**
 * The resident memory (working set) of a running process in bytes, from `tasklist`, which names
 * it in KiB with digit grouping, such as `"12,345 K"`. A process that has ended, or a reading
 * that fails, is `undefined`.
 */
export async function win32ResidentBytes(
  pid: number,
  signal: AbortSignal,
): Promise<number | undefined> {
  try {
    const args = ["/FI", `PID eq ${String(pid)}`, "/FO", "CSV", "/NH"];
    const row = await runCommand("tasklist", args, signal);
    const kib = /"([\d.,\s]+) K"\s*$/m.exec(row)?.[1]?.replace(/[^\d]/g, "");
    return kib === undefined || kib === "" ? undefined : Number(kib) * 1024;
  } catch {
    return undefined;
  }
}
