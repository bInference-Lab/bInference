import { join } from "node:path";
import { readTextFile } from "@binference/platform";
import { createSystemClock } from "../runtime/system-clock.js";

// How often the smoke reads the engine log while it waits.
const readEveryMs = 200;

/**
 * Waits until the engine of the install in `home` started its agent's paper portfolio, as it does
 * on its own once it serves (decision 0450): its log names `engine.paper_started`. The smoke gives
 * the agent nothing itself, so a trade fills only from the start an owner's install makes. Reads
 * the log every 200 ms; rejects with the signal's reason once it aborts.
 */
export async function waitForPaperStart(home: string, signal: AbortSignal): Promise<void> {
  const clock = createSystemClock();
  const file = join(home, "logs", "engine.log");
  const read = async (): Promise<void> => {
    const text = await readTextFile(file, signal);
    if (text.ok && text.value.includes('"event":"engine.paper_started"')) {
      return;
    }
    await clock.sleep(readEveryMs, signal);
    await read();
  };
  await read();
}
