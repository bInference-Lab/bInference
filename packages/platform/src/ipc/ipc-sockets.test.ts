import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listenOn } from "./ipc-sockets.js";

describe.skipIf(process.platform === "win32")("ipc sockets", () => {
  it("names the fault when the address cannot be bound", async () => {
    const folder = await mkdtemp(join(tmpdir(), "bnf-"));

    await expect(
      listenOn(join(folder, "missing", "engine.sock"), {
        signal: new AbortController().signal,
        onSocket: () => undefined,
      }),
    ).rejects.toMatchObject({ code: "platform.ipc_listen_failed" });
    await rm(folder, { recursive: true });
  });
});
