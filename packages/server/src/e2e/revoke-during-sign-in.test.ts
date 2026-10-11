import type { AccessStore } from "@binference/engine";
import { afterEach, describe, expect, it } from "vitest";
import { challengeOf, openFrame, openRawSocket, type RawSocket } from "./raw-socket.js";
import { proofSignature, startTestServer, type TestServer } from "./test-server.js";

const live = { signal: AbortSignal.timeout(5_000) };

/** When a held write reaches the store: on release, or at once with its answer held. */
type Hold = "write_on_release" | "answer_on_release";

interface HeldWrite {
  readonly release: () => void;
}

/** Holds each `markDeviceSeen` and `markTokenUsed` in the order of `holds`, until released. */
interface Gate {
  readonly wrap: (access: AccessStore) => AccessStore;
  /** Resolves with the next held write once it arrives. */
  readonly next: () => Promise<HeldWrite>;
}

function createGate(holds: readonly Hold[]): Gate {
  const queue = [...holds];
  const arrived: HeldWrite[] = [];
  const waiters: ((write: HeldWrite) => void)[] = [];
  const arrive = (write: HeldWrite): void => {
    const waiter = waiters.shift();
    if (waiter === undefined) {
      arrived.push(write);
    } else {
      waiter(write);
    }
  };
  const held = async <T>(write: () => Promise<T>): Promise<T> => {
    const hold = queue.shift();
    if (hold === undefined) {
      return write();
    }
    const early = hold === "answer_on_release" ? await write() : undefined;
    await new Promise<void>((release) => arrive({ release }));
    return early ?? write();
  };
  return {
    wrap: (access) => ({
      ...access,
      markDeviceSeen: async (seen, options) =>
        held(async () => access.markDeviceSeen(seen, options)),
      markTokenUsed: async (use, options) => held(async () => access.markTokenUsed(use, options)),
    }),
    next: async () => arrived.shift() ?? new Promise((resolve) => waiters.push(resolve)),
  };
}

// Opens a device connection and answers its challenge; the proof's write then waits at the gate.
async function proveDevice(server: TestServer): Promise<RawSocket> {
  const raw = await openRawSocket(server.wsUrl, { origin: server.origin });
  raw.send(openFrame({ device: server.device.id }));
  const challenge = challengeOf(await raw.next());
  raw.send({
    t: "prove",
    signature: proofSignature(server.device, { ...challenge, origin: server.origin }),
  });
  return raw;
}

describe("a revoke that lands while connections sign in", () => {
  let test: TestServer | undefined;

  afterEach(async () => {
    await test?.close();
    test = undefined;
  });

  async function start(gate: Gate): Promise<TestServer> {
    test = await startTestServer({ wrapAccess: gate.wrap });
    return test;
  }

  it("ends every staggered device connection as revoked and lets none be ready", async () => {
    const gate = createGate(["write_on_release", "answer_on_release"]);
    const server = await start(gate);
    const writeLate = await proveDevice(server);
    const heldWrite = await gate.next();
    const answerLate = await proveDevice(server);
    const heldAnswer = await gate.next();
    const proving = await openRawSocket(server.wsUrl, { origin: server.origin });
    proving.send(openFrame({ device: server.device.id }));
    const challenge = challengeOf(await proving.next());
    const opening = await openRawSocket(server.wsUrl, { origin: server.origin });
    await server.access.revokeDevice({ id: server.device.id, atMs: server.clock.now() }, live);
    server.server.endSessions(server.device.id, "auth.revoked");
    heldWrite.release();
    heldAnswer.release();
    proving.send({
      t: "prove",
      signature: proofSignature(server.device, { ...challenge, origin: server.origin }),
    });
    opening.send(openFrame({ device: server.device.id }));
    const frames = await Promise.all(
      [writeLate, answerLate, proving, opening].map((r) => r.next()),
    );
    const revoked = { t: "bye", code: "auth.revoked" };
    expect(frames).toMatchObject([revoked, revoked, revoked, revoked]);
  });

  it.each(["write_on_release", "answer_on_release"] as const)(
    "ends a token connection whose use is held (%s) when the token is revoked",
    async (hold) => {
      const gate = createGate([hold]);
      const server = await start(gate);
      const raw = await openRawSocket(server.ipcUrl);
      raw.send(openFrame({ token: server.mcpToken.secret }));
      const held = await gate.next();
      await server.access.revokeToken({ id: server.mcpToken.id, atMs: server.clock.now() }, live);
      server.server.endSessions(server.mcpToken.id, "auth.revoked");
      held.release();
      await expect(raw.next()).resolves.toMatchObject({ t: "bye", code: "auth.revoked" });
    },
  );
});
