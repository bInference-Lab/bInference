import { once } from "node:events";
// oxlint-disable-next-line eslint/no-restricted-imports -- the test reads the loopback server it started
import { get, type IncomingMessage } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { type LoopbackAnswer, type LoopbackFiles, startLoopbackFiles } from "./loopback-files.js";

let files: LoopbackFiles | undefined;

afterEach(async () => {
  await files?.close();
  files = undefined;
});

const answers: Readonly<Record<string, LoopbackAnswer>> = {
  "/install.sh": { body: new TextEncoder().encode("echo hi\n") },
  "/moved.tgz": { redirectTo: "http://127.0.0.1:1/elsewhere.tgz" },
};

// One GET that never follows a redirect: its status, headers and body.
async function read(
  url: string,
): Promise<{ readonly response: IncomingMessage; readonly body: string }> {
  const request = get(url, { signal: AbortSignal.timeout(5_000) });
  const [response] = (await once(request, "response")) as [IncomingMessage];
  const chunks: Buffer[] = [];
  response.on("data", (chunk: Buffer) => chunks.push(chunk));
  await once(response, "end");
  return { response, body: Buffer.concat(chunks).toString("utf8") };
}

describe("loopback files", () => {
  it("serves bytes, redirects and 404s, and records each path", async () => {
    files = await startLoopbackFiles((path) => answers[path]);

    const script = await read(`${files.base}/install.sh`);
    const moved = await read(`${files.base}/moved.tgz`);
    const missing = await read(`${files.base}/nothing`);

    expect(script.body).toBe("echo hi\n");
    expect(script.response.headers["content-type"]).toBe("text/plain; charset=utf-8");
    expect(moved.response.statusCode).toBe(302);
    expect(moved.response.headers.location).toBe("http://127.0.0.1:1/elsewhere.tgz");
    expect(missing.response.statusCode).toBe(404);
    expect(files.requests()).toEqual(["/install.sh", "/moved.tgz", "/nothing"]);
  });
});
