import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  serviceManagerContract,
  type ServiceManagerHarness,
} from "../contracts/service-manager-contract.js";
import type { ServiceManager } from "../ports.js";
import { createMemoryServiceManager } from "./memory-service-manager.js";

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

function memoryHarness(): ServiceManagerHarness {
  let manager: ServiceManager = createMemoryServiceManager();
  return {
    create: async () => {
      manager = createMemoryServiceManager();
      const folder = await mkdtemp(join(tmpdir(), "bnf-"));
      folders.push(folder);
      return { manager, folder };
    },
    leftovers: async (name) => {
      const status = await manager.status(name, new AbortController().signal);
      return status.state === "not_installed" ? [] : [`${name} is ${status.state}`];
    },
  };
}

describe("memory service manager", () => {
  it.each(serviceManagerContract(memoryHarness()))(
    "follows the contract: $name",
    async ({ run }) => {
      await expect(run()).resolves.toBeUndefined();
    },
  );
});
