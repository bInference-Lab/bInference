import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import type { Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { duplexPair } from "node:stream";
import { decimalStringSchema, type Result } from "@binference/core";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import type { IpcEndpoint } from "../ports.js";
import { createPosixFilePermissions } from "../posix/posix-file-permissions.js";
import { createPosixIpcEndpoint } from "../posix/posix-ipc-endpoint.js";
import { resolveStateFolder } from "../state-folder.js";
import { createWin32IpcEndpoint } from "../win32/win32-ipc-endpoint.js";
import type { IpcBinding } from "./ipc-binding.js";
import { openIpcChannel } from "./ipc-channel.js";

const requestSchema = z.object({ op: z.literal("authorize"), amountBase: decimalStringSchema });
const replySchema = z.object({ signature: z.string() });

const folders: string[] = [];
const bindings: IpcBinding[] = [];

afterEach(async () => {
  await Promise.all(bindings.splice(0).map(async (binding) => binding.close()));
  await Promise.all(folders.splice(0).map(async (folder) => rm(folder, { recursive: true })));
});

function valueOf<T>(result: Result<T, string>): T {
  if (!result.ok) {
    throw new Error(`Expected a value, got ${result.error}.`);
  }
  return result.value;
}

function signal(): AbortSignal {
  return new AbortController().signal;
}

function pair(serverKey: Uint8Array, clientKey: Uint8Array) {
  const [serverSide, clientSide] = duplexPair();
  const server = openIpcChannel({
    socket: serverSide,
    key: serverKey,
    role: "server",
    inbound: requestSchema,
    outbound: replySchema,
    signal: signal(),
  });
  const client = openIpcChannel({
    socket: clientSide,
    key: clientKey,
    role: "client",
    inbound: replySchema,
    outbound: requestSchema,
    signal: signal(),
  });
  return { server, client, serverSide, clientSide };
}

// The endpoint this OS uses: a named pipe on Windows, a socket in the run folder elsewhere.
function signerEndpoint(home: string): IpcEndpoint {
  return process.platform === "win32"
    ? createWin32IpcEndpoint({ name: "signer", installId: randomUUID() })
    : createPosixIpcEndpoint({
        runFolder: resolveStateFolder({ binferenceHome: home }).run,
        name: "signer",
        permissions: createPosixFilePermissions(),
      });
}

// The listener's side of one exchange: it answers one request and returns its amount.
async function serveOne(socket: Socket, key: Uint8Array): Promise<bigint> {
  const channel = await openIpcChannel({
    socket,
    key,
    role: "server",
    inbound: requestSchema,
    outbound: replySchema,
    signal: signal(),
  });
  const request = await channel.receive(signal());
  await channel.send({ signature: "0xsigned" }, signal());
  return request.amountBase;
}

describe("ipc channel", () => {
  it("carries a request and its reply through a real endpoint on this OS", async () => {
    const home = await mkdtemp(join(tmpdir(), "bnf-"));
    folders.push(home);
    const endpoint = signerEndpoint(home);
    const key = randomBytes(32);
    const served: Promise<bigint>[] = [];
    const binding = valueOf(
      await endpoint.bind({
        signal: signal(),
        onSocket: (socket: Socket) => {
          served.push(serveOne(socket, key));
        },
      }),
    );
    bindings.push(binding);

    const client = await openIpcChannel({
      socket: valueOf(await endpoint.connect(signal())),
      key,
      role: "client",
      inbound: replySchema,
      outbound: requestSchema,
      signal: signal(),
    });
    await client.send({ op: "authorize", amountBase: 2n ** 64n + 1n }, signal());

    await expect(client.receive(signal())).resolves.toStrictEqual({ signature: "0xsigned" });
    await expect(Promise.all(served)).resolves.toStrictEqual([2n ** 64n + 1n]);
    client.close();
  });

  it("refuses a peer that does not hold the key, on both sides", async () => {
    const { server, client } = pair(randomBytes(32), randomBytes(32));

    await expect(server).rejects.toMatchObject({ code: "platform.ipc_unauthenticated" });
    await expect(client).rejects.toMatchObject({ code: "platform.ipc_unauthenticated" });
  });

  it("refuses a handshake that does not open with a 32-byte nonce", async () => {
    const [serverSide, clientSide] = duplexPair();
    const server = openIpcChannel({
      socket: serverSide,
      key: randomBytes(32),
      role: "server",
      inbound: requestSchema,
      outbound: replySchema,
      signal: signal(),
    });

    clientSide.write(Buffer.from([0, 0, 0, 1, 7]));

    await expect(server).rejects.toMatchObject({ code: "platform.ipc_unauthenticated" });
  });

  it("refuses a key shorter than 32 bytes", async () => {
    const [socket] = duplexPair();

    await expect(
      openIpcChannel({
        socket,
        key: randomBytes(16),
        role: "client",
        inbound: replySchema,
        outbound: requestSchema,
        signal: signal(),
      }),
    ).rejects.toMatchObject({ code: "platform.ipc_weak_key" });
  });

  it("closes the channel on a message that breaks its schema", async () => {
    const key = randomBytes(32);
    const { server, client, clientSide } = pair(key, key);
    const [serverChannel] = await Promise.all([server, client]);

    // One frame that holds the two bytes of "{}", which has no op and no amount.
    clientSide.write(Buffer.from([0, 0, 0, 2, 0x7b, 0x7d]));

    await expect(serverChannel.receive(signal())).rejects.toMatchObject({
      code: "platform.ipc_bad_message",
    });
    await expect(serverChannel.receive(signal())).rejects.toMatchObject({
      code: "platform.ipc_closed",
    });
  });

  it("refuses a frame larger than the limit and closes", async () => {
    const key = randomBytes(32);
    const { server, client, clientSide } = pair(key, key);
    const [serverChannel] = await Promise.all([server, client]);

    clientSide.write(Buffer.from([0x10, 0, 0, 0]));

    await expect(serverChannel.receive(signal())).rejects.toMatchObject({
      code: "platform.ipc_frame_too_large",
    });
  });

  it("ends a pending receive when the peer goes away", async () => {
    const key = randomBytes(32);
    const { server, client } = pair(key, key);
    const [serverChannel, clientChannel] = await Promise.all([server, client]);

    const receiving = serverChannel.receive(signal());
    clientChannel.close();

    await expect(receiving).rejects.toMatchObject({ code: "platform.ipc_closed" });
  });

  it("stops a receive when its signal aborts", async () => {
    const key = randomBytes(32);
    const { server, client } = pair(key, key);
    const [serverChannel] = await Promise.all([server, client]);
    const controller = new AbortController();
    const reason = new Error("deadline");

    const receiving = serverChannel.receive(controller.signal);
    controller.abort(reason);

    await expect(receiving).rejects.toBe(reason);
  });
});
