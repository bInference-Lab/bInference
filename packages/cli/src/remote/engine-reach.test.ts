import { createServer } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { freePort } from "../e2e/test-host.js";
import { answersBeyondLoopback } from "./engine-reach.js";

const live = new AbortController().signal;
const servers: ReturnType<typeof createServer>[] = [];

afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(async (server) => new Promise((resolve) => server.close(resolve))),
  );
});

describe("answersBeyondLoopback", () => {
  it("answers whether anything takes a connection at the port on the addresses named", async () => {
    const server = createServer();
    servers.push(server);
    const port = await freePort();
    await new Promise<void>((resolve) => {
      server.listen(port, "127.0.0.1", () => resolve());
    });
    await expect(answersBeyondLoopback(port, live, ["127.0.0.1"])).resolves.toBe(true);
    await expect(answersBeyondLoopback(await freePort(), live, ["127.0.0.1"])).resolves.toBe(false);
    await expect(answersBeyondLoopback(port, live, [])).resolves.toBe(false);
  });
});
