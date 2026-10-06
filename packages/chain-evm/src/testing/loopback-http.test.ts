import { httpContract } from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createLoopbackHttp } from "./loopback-http.js";
import { type LoopbackServer, refusingLoopbackUrl, serveLoopback } from "./loopback-server.js";

const servers: LoopbackServer[] = [];
let refusedUrl = "";

beforeAll(async () => {
  servers.push(
    await serveLoopback(() => ({ status: 200, body: "ok" })),
    await serveLoopback(() => ({ status: 404, body: "" })),
    await serveLoopback(() => "hang"),
  );
  refusedUrl = await refusingLoopbackUrl();
});

afterAll(async () => {
  await Promise.all(servers.map((server) => server.close()));
});

const urlOf = (index: number): string => servers[index]?.url ?? "";

describe("loopback http", () => {
  it.each(
    httpContract({
      create: () => ({
        http: createLoopbackHttp(),
        okUrl: urlOf(0),
        missingUrl: urlOf(1),
        unreachableUrl: refusedUrl,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("refuses any host but the loopback address", async () => {
    await expect(
      createLoopbackHttp().request({
        method: "GET",
        url: "https://bsc.invalid/",
        signal: new AbortController().signal,
      }),
    ).rejects.toMatchObject({ code: "http.not_loopback" });
  });

  it("drops a request that hangs once its signal aborts", async () => {
    const hanging = servers[2];
    const controller = new AbortController();
    const pending = createLoopbackHttp().request({
      method: "POST",
      url: urlOf(2),
      body: "{}",
      signal: controller.signal,
    });
    await hanging?.firstRequest;
    const reason = new Error("stopped");
    controller.abort(reason);
    await expect(pending).rejects.toBe(reason);
    await expect(hanging?.dropped).resolves.toBeUndefined();
  });
});
