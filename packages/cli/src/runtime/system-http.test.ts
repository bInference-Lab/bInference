// oxlint-disable-next-line eslint/no-restricted-imports -- the test serves the adapter's answers from a loopback server
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { httpContract } from "@binference/core/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSystemHttp, type SystemHttp } from "./system-http.js";

const pages: Readonly<
  Record<string, (request: IncomingMessage, response: ServerResponse) => void>
> = {
  "/ok": (_, response) => {
    response.end("ok");
  },
  "/echo": (request, response) => {
    const parts: Buffer[] = [];
    request.on("data", (part: Buffer) => parts.push(part));
    request.on("end", () => {
      response.setHeader("X-Echo-Method", request.method ?? "");
      response.setHeader("Set-Cookie", ["a=1", "b=2"]);
      response.end(`${String(request.headers["x-test"])}:${Buffer.concat(parts).toString("utf8")}`);
    });
  },
  "/large": (_, response) => {
    response.end(Buffer.alloc(8 * 1024 * 1024 + 1, 97));
  },
};

const held: { server?: Server; origin: string; closed: string } = { origin: "", closed: "" };
const adapters: SystemHttp[] = [];

async function listen(server: Server): Promise<string> {
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => resolve());
  });
  const address = server.address();
  return typeof address === "object" && address !== null
    ? `http://127.0.0.1:${String(address.port)}`
    : "";
}

beforeAll(async () => {
  held.server = createServer((request, response) => {
    const page = pages[request.url ?? ""];
    if (page === undefined) {
      response.writeHead(404).end();
      return;
    }
    page(request, response);
  });
  held.origin = await listen(held.server);
  // A port that was bound and freed: nothing listens there now.
  const spare = createServer();
  held.closed = await listen(spare);
  await new Promise<void>((resolve) => {
    spare.close(() => resolve());
  });
});

afterAll(async () => {
  await Promise.all(adapters.splice(0).map(async (made) => made.close()));
  await new Promise<void>((resolve) => {
    held.server?.close(() => resolve());
  });
});

function adapter(): SystemHttp {
  const created = createSystemHttp();
  adapters.push(created);
  return created;
}

const live = (): AbortSignal => new AbortController().signal;

describe("the system Http adapter", () => {
  it.each(
    httpContract({
      create: () => ({
        http: adapter(),
        okUrl: `${held.origin}/ok`,
        missingUrl: `${held.origin}/missing`,
        unreachableUrl: `${held.closed}/ok`,
      }),
    }),
  )("follows the contract: $name", async ({ run }) => {
    await expect(run()).resolves.toBeUndefined();
  });

  it("sends the method, headers and body, and answers headers in lowercase", async () => {
    const answer = await adapter().request({
      method: "POST",
      url: `${held.origin}/echo`,
      headers: { "X-Test": "yes" },
      body: "payload",
      signal: live(),
    });
    expect(answer.body).toBe("yes:payload");
    expect(answer.headers["x-echo-method"]).toBe("POST");
    expect(answer.headers["set-cookie"]).toBe("a=1, b=2");
  });

  it("refuses an answer over 8 MiB", async () => {
    await expect(
      adapter().request({ method: "GET", url: `${held.origin}/large`, signal: live() }),
    ).rejects.toMatchObject({ code: "http.answer_too_large", retryable: false });
  });

  it("names only the method and origin of a request that got no answer", async () => {
    const failed = await adapter()
      .request({ method: "GET", url: `${held.closed}/private/path?token=x`, signal: live() })
      .catch((error: unknown) => error);
    expect(failed).toMatchObject({
      code: "http.unreachable",
      details: { method: "GET", origin: held.closed },
    });
    expect(JSON.stringify(failed)).not.toContain("token=x");
  });
});
