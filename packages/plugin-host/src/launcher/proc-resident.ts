// oxlint-disable-next-line eslint/no-restricted-imports -- the image's launcher reads its plugins' memory from /proc
import { readFile } from "node:fs/promises";
import { setTimeout as sleep } from "node:timers/promises";
import type { ResidentWatch } from "../host/watch-resident.js";

/**
 * The image's watch of a plugin's memory (decision 0343): its resident size from Linux's
 * `/proc/<pid>/status`, read every 2 seconds on this process's own timers. The launcher reads it
 * with no library, so it loads no more code than it needs.
 */
export const procResident: ResidentWatch = {
  read: async (pid, signal) => {
    try {
      const status = await readFile(`/proc/${String(pid)}/status`, { encoding: "utf8", signal });
      const kb = /^VmRSS:\s+(\d+)\s+kB$/m.exec(status)?.[1];
      return kb === undefined ? undefined : Number(kb) * 1024;
    } catch {
      return undefined;
    }
  },
  wait: async (delayMs, signal) => {
    await sleep(delayMs, undefined, { signal });
  },
};
