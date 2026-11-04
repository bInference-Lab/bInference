import process from "node:process";
import {
  createTempFolder,
  serviceManagerContract,
  type TempFolder,
} from "@binference/platform/testing";
import { afterEach, describe, expect, it } from "vitest";
import { createChildServices } from "./child-services.js";

const folders: TempFolder[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => folder.remove()));
});

describe("the update smoke's child services", () => {
  it.each(
    serviceManagerContract({
      create: async () => {
        const folder = await createTempFolder("child-services-");
        folders.push(folder);
        const manager = createChildServices({ parentEnv: process.env, env: {} });
        return { manager, folder: folder.path };
      },
      // A child process leaves nothing with the OS once it ended.
      leftovers: async () => Promise.resolve([]),
    }),
  )("follows the service manager contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
