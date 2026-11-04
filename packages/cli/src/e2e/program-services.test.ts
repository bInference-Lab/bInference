import {
  createTempFolder,
  serviceManagerContract,
  type TempFolder,
} from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createProgramServices } from "./program-services.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

// Runs that only remember whether a program runs, as a program that starts at once would.
function flagRuns() {
  const state = { isRunning: false };
  return {
    start: async () => {
      state.isRunning = true;
      return Promise.resolve();
    },
    end: async () => {
      state.isRunning = false;
      return Promise.resolve();
    },
    isRunning: () => state.isRunning,
    forget: () => undefined,
  };
}

describe("the program services of tests", () => {
  it.each(
    serviceManagerContract({
      create: async () => {
        const folder = await createTempFolder("program-services-");
        folders.push(folder);
        return { manager: createProgramServices(flagRuns()), folder: folder.path };
      },
      // No program outlives its test, so the OS holds nothing.
      leftovers: async () => Promise.resolve([]),
    }),
  )("follows the service manager contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
