import { generateKeyPairSync } from "node:crypto";
import { protocolIdSchema } from "@binference/protocol";
import { afterEach, describe, expect, it } from "vitest";
import { requestLocal } from "./local-http.js";
import { challengeOf, openFrame, openRawSocket } from "./raw-socket.js";
import { proofSignature, startTestServer, type TestServer } from "./test-server.js";

const unknownDevice = "dev_0190f1c2-3a4b-7c5d-8e6f-000000000099";
const publicKey = generateKeyPairSync("ed25519")
  .publicKey.export({ format: "der", type: "spki" })
  .toString("base64url");

// Signs in with an unknown device, which the engine refuses.
async function failOnce(server: TestServer): Promise<unknown> {
  const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
  raw.send(openFrame({ device: protocolIdSchema("consoleDevice").parse(unknownDevice) }));
  return raw.next();
}

describe("failed sign-ins and pairings", () => {
  let test: TestServer | undefined;

  async function start(): Promise<TestServer> {
    test = await startTestServer({ limits: { authMaxFailures: 3 } });
    return test;
  }

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  it("refuses a source that failed too often, even with a good device, and logs no credential", async () => {
    const server = await start();
    const refusals = [await failOnce(server), await failOnce(server), await failOnce(server)];
    expect(refusals).toMatchObject([
      { t: "bye", code: "auth.invalid" },
      { t: "bye", code: "auth.invalid" },
      { t: "bye", code: "auth.invalid" },
    ]);
    const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
    raw.send(openFrame({ device: server.device.id }));
    await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "protocol.busy" });
    const records = server.logger.records();
    const failed = records.filter((record) => record.event === "server.auth_failed");
    expect(failed.map((record) => record.fields.errorCode)).toStrictEqual([
      "auth.invalid",
      "auth.invalid",
      "auth.invalid",
    ]);
    expect(JSON.stringify(records)).not.toContain(unknownDevice);
    expect(records.map((record) => record.event)).toContain("server.auth_locked_out");
  });

  it("reports one lockout per locked source and credential, not one per failure", async () => {
    const server = await start();
    await failOnce(server);
    await failOnce(server);
    await failOnce(server);
    await server.clock.advance(5 * 60_000);
    await failOnce(server);
    await failOnce(server);
    await failOnce(server);
    const untilMs = 1_000_000 + 5 * 60_000;
    expect(server.lockouts).toMatchObject([
      { kind: "address", untilMs },
      { kind: "device", device: unknownDevice, untilMs },
    ]);
    expect(JSON.stringify(server.logger.records())).not.toContain(unknownDevice);
  });

  it("lets the source in again once the lockout passed", async () => {
    const server = await start();
    await failOnce(server);
    await failOnce(server);
    await failOnce(server);
    await server.clock.advance(5 * 60_000);
    const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
    raw.send(openFrame({ device: server.device.id }));
    const challenge = challengeOf(await raw.next());
    const signature = proofSignature(server.device, { ...challenge, origin: server.origin });
    raw.send({ t: "prove", signature });
    await expect(raw.next()).resolves.toMatchObject({ t: "ready" });
    raw.close();
  });

  it("answers 429 to a source whose pairing codes failed too often, and logs no code", async () => {
    const server = await start();
    const pairWith = async (code: string) =>
      requestLocal(server.httpPort, {
        path: "/pair",
        method: "POST",
        headers: { origin: server.origin, "content-type": "application/json" },
        body: JSON.stringify({ code, publicKey, alg: "ed25519", label: "Laptop" }),
      });
    const codes = ["AAAAAAAAAAAAAAAAAAAAAA", "BBBBBBBBBBBBBBBBBBBBBB", "CCCCCCCCCCCCCCCCCCCCCC"];
    const statuses = await [...codes, "DDDDDDDDDDDDDDDDDDDDDD"].reduce<Promise<number[]>>(
      async (previous, code) => [...(await previous), (await pairWith(code)).status],
      Promise.resolve([]),
    );
    expect(statuses).toStrictEqual([401, 401, 401, 429]);
    expect(server.lockouts).toMatchObject([{ kind: "address", untilMs: 1_000_000 + 5 * 60_000 }]);
    expect(JSON.stringify(server.logger.records())).not.toContain("AAAAAAAAAAAAAAAAAAAAAA");
  });
});
