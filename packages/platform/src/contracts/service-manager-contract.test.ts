import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ok } from "@binference/core";
import type { ContractCheck } from "@binference/core/testing";
import { afterEach, describe, expect, it } from "vitest";
import { serviceManagerContract } from "./service-manager-contract.js";

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

describe("service manager contract", () => {
  it("fails a manager that takes anything and reports every service as stopped", async () => {
    const checks = serviceManagerContract({
      create: async () => {
        const folder = await mkdtemp(join(tmpdir(), "bnf-"));
        folders.push(folder);
        return {
          manager: {
            install: async () => undefined,
            uninstall: async () => ok(undefined),
            status: async () => ({ state: "stopped", startsAtLogin: false }),
          },
          folder,
        };
      },
      leftovers: async () => [],
    });
    const results = await Promise.allSettled(
      checks.map(async (check: ContractCheck) => check.run()),
    );
    expect(results.map((result) => result.status)).toStrictEqual(checks.map(() => "rejected"));
    expect(checks).toHaveLength(6);
  });
});
