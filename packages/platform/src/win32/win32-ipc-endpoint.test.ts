import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ipcEndpointContract } from "../contracts/ipc-endpoint-contract.js";
import { createWin32IpcEndpoint } from "./win32-ipc-endpoint.js";

describe("windows ipc endpoint address", () => {
  it("names a pipe after the install and the endpoint", () => {
    const endpoint = createWin32IpcEndpoint({ installId: "ins_0192f0c1", name: "engine" });

    expect(endpoint.address).toBe("\\\\.\\pipe\\binference-ins_0192f0c1-engine");
  });

  it("refuses an install id that could change the pipe path", () => {
    expect(() => createWin32IpcEndpoint({ installId: "a\\b", name: "engine" })).toThrow(
      expect.objectContaining({ code: "platform.ipc_bad_name" }),
    );
  });
});

describe.runIf(process.platform === "win32")("windows ipc endpoint", () => {
  it.each(
    ipcEndpointContract({
      create: async () => {
        await Promise.resolve();
        return createWin32IpcEndpoint({ installId: randomUUID(), name: "engine" });
      },
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });
});
