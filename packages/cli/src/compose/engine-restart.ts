import { join } from "node:path";
import type { Clock } from "@binference/core";
import {
  type FilePermissions,
  type Platform,
  readTextFile,
  removePath,
  writePrivateFile,
} from "@binference/platform";
import { type RestartRecord, type RestartWhy, restartRecordOf } from "./restart-record.schema.js";

/** How long a restart waits after it is asked for, so the card's receipt reaches the chat first. */
const restartDelayMs = 2_000;

/**
 * The engine's restart of itself (decision 0395): it leaves a record in the state folder, then
 * runs the shutdown sequence; the process starts the engine again, which tells the owner what the
 * restart applied.
 */
export interface EngineRestart {
  /** Leaves the record and stops the engine after a short wait; a second ask joins the first. */
  request(why: RestartWhy, signal: AbortSignal): Promise<void>;
  /** Whether the engine stops to start again, not to end. */
  isRequested(): boolean;
}

function recordFileOf(stateRoot: string): string {
  return join(stateRoot, "restart.json");
}

/** Creates the restart over the stopper the shutdown sequence fills. */
function createEngineRestart(parts: {
  readonly stateRoot: string;
  readonly permissions: FilePermissions;
  readonly stopper: { readonly stop: () => void };
  readonly clock: Clock;
}): EngineRestart {
  let isRequested = false;
  return {
    async request(why, signal) {
      if (isRequested) {
        return;
      }
      isRequested = true;
      const text = `${JSON.stringify({ ...why, atMs: parts.clock.now() })}\n`;
      await writePrivateFile(recordFileOf(parts.stateRoot), text, {
        permissions: parts.permissions,
        signal,
      });
      void parts.clock.sleep(restartDelayMs, signal).then(
        () => parts.stopper.stop(),
        () => parts.stopper.stop(),
      );
    },
    isRequested: () => isRequested,
  };
}

/**
 * The call that `engine/stop` makes once the shutdown sequence exists, and the restart over it
 * (decision 0395), which stops through the same call.
 */
export interface EngineStopper {
  stop: () => void;
  readonly restart: EngineRestart;
}

/** Creates the stopper, which stops nothing until the shutdown sequence fills `stop`. */
export function createEngineStopper(
  platform: Pick<Platform, "stateFolder" | "permissions">,
  clock: Clock,
): EngineStopper {
  const holder = { stop: (): void => undefined };
  const restart = createEngineRestart({
    stateRoot: platform.stateFolder.root,
    permissions: platform.permissions,
    stopper: { stop: () => holder.stop() },
    clock,
  });
  return {
    get stop() {
      return holder.stop;
    },
    set stop(stop: () => void) {
      holder.stop = stop;
    },
    restart,
  };
}

/**
 * The record a restart left, removed as it is read so a later start never tells it twice;
 * `undefined` when there is none or it does not read.
 */
export async function takeRestartRecord(
  stateRoot: string,
  signal: AbortSignal,
): Promise<RestartRecord | undefined> {
  const read = await readTextFile(recordFileOf(stateRoot), signal);
  if (!read.ok) {
    return undefined;
  }
  await removePath(recordFileOf(stateRoot), signal);
  return restartRecordOf(read.value);
}
